import { AppError, type Core, type Device, type DeviceKind, pairingLink } from "@tau/protocol";
import { deviceKindFromName, nameFromUserAgent } from "./device-names";
import { createPairingCodes, looksLikeShortCode } from "./pairing-codes";
import type { AccessDeps, StoredDevice } from "./ports";
import { createRedeemLimits } from "./redeem-limits";
import { safeEqual, sha256Hex } from "./secrets";

/** What `Core.access` is, plus what the remote service needs when a URL dies. */
export type AccessService = Core["access"] & {
  /** Removes every device and node (their cookies and links belong to the old host). */
  clearAll(): Promise<void>;
  /**
   * Stores the verified `nodeId` and public key on a node device at its first `hello`. A device that already
   * has another identity, or a `nodeId` already held by another device with another key, is never overwritten.
   * `duplicate-device`: another node device already carries that `nodeId` (glare or a second `tau connect`:
   * the link arbiter decides, see `duplicate-links.ts`).
   */
  bindNodeIdentity(deviceId: string, identity: { nodeId: string; publicKey: string }): Promise<BindResult>;
  /** The node device that carries `nodeId`, if any. */
  findNodeDevice(nodeId: string): Promise<Device | undefined>;
};

export type BindResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "not-found" | "identity-conflict" | "duplicate-device";
      readonly otherDeviceId?: string;
    };

const TOUCH_THROTTLE_MS = 60_000;
const WRONG_CODE = "That code did not work.";
const wrongCode = () => new AppError("unauthorized", WRONG_CODE);

export function createAccess(deps: AccessDeps): AccessService {
  const codes = createPairingCodes(deps.now, deps.randomBytes);
  const limits = createRedeemLimits(deps.now);
  let cache: Promise<StoredDevice[]> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const load = () => {
    cache ??= deps.store.read();
    return cache;
  };
  const save = async (next: StoredDevice[]) => {
    cache = Promise.resolve(next);
    const run = writing.then(() => deps.store.write(next));
    writing = run.catch(() => undefined);
    await run;
  };
  /** Every read-modify-write of the device list runs one at a time, so concurrent updates are never lost. */
  let transactions: Promise<unknown> = Promise.resolve();
  const transaction = <T>(run: () => Promise<T>): Promise<T> => {
    const next = transactions.then(run, run);
    transactions = next.catch(() => undefined);
    return next;
  };
  const find = async (secret: string, node: boolean) => {
    const hash = sha256Hex(secret);
    let found: StoredDevice | undefined;
    for (const device of await load()) {
      if (safeEqual(device.secretHash, hash) && (device.kind === "node") === node) found = device;
    }
    return found ? { deviceId: found.id } : undefined;
  };
  const toDevice = (device: StoredDevice, currentId?: string): Device => {
    const { secretHash: _hash, publicKey: _key, ...rest } = device;
    return { ...rest, current: device.kind !== "node" && device.id === currentId };
  };

  async function redeem(input: Parameters<Core["access"]["redeemPairing"]>[0]) {
    if (limits.peerLocked(input.peer)) throw wrongCode();
    if (looksLikeShortCode(input.code.trim()) && limits.shortCodesLocked()) throw wrongCode();
    const pairing = codes.take(input.code);
    if (!pairing) {
      limits.recordFailure(input.peer);
      throw wrongCode();
    }
    const secret = deps.randomBytes(32).toString("hex");
    const kind: DeviceKind = pairing.kind === "node" ? "node" : deviceKindFromName(input.deviceName);
    const at = deps.now();
    const device: StoredDevice = {
      id: deps.randomBytes(8).toString("hex"),
      name: input.deviceName.trim() || nameFromUserAgent(input.userAgent),
      kind,
      createdAt: at,
      lastSeenAt: at,
      secretHash: sha256Hex(secret),
    };
    await transaction(async () => save([...(await load()), device]));
    deps.announce();
    const nodeId = pairing.kind === "node" ? deps.nodeId?.() : undefined;
    return { deviceId: device.id, kind: pairing.kind, secret, ...(nodeId ? { nodeId } : {}) };
  }

  const bindIdentity = async (
    deviceId: string,
    { nodeId, publicKey }: { nodeId: string; publicKey: string },
  ): ReturnType<AccessService["bindNodeIdentity"]> => {
    const devices = await load();
    const device = devices.find((entry) => entry.id === deviceId && entry.kind === "node");
    if (!device) return { ok: false, reason: "not-found" };
    if (device.nodeId !== undefined && (device.nodeId !== nodeId || device.publicKey !== publicKey)) {
      return { ok: false, reason: "identity-conflict" };
    }
    const holder = devices.find(
      (entry) => entry.id !== deviceId && entry.kind === "node" && entry.nodeId === nodeId,
    );
    if (holder) {
      return holder.publicKey === publicKey
        ? { ok: false, reason: "duplicate-device", otherDeviceId: holder.id }
        : { ok: false, reason: "identity-conflict", otherDeviceId: holder.id };
    }
    if (device.nodeId === nodeId) return { ok: true };
    await save(devices.map((entry) => (entry === device ? { ...device, nodeId, publicKey } : entry)));
    deps.announce();
    return { ok: true };
  };

  return {
    verifyDevice: (secret) => find(secret, false),
    verifyNode: (secret) => find(secret, true),
    touch(deviceId) {
      void transaction(async () => {
        const devices = await load();
        const device = devices.find((entry) => entry.id === deviceId);
        if (!device || deps.now() - device.lastSeenAt < TOUCH_THROTTLE_MS) return;
        await save(
          devices.map((entry) => (entry === device ? { ...device, lastSeenAt: deps.now() } : entry)),
        );
      }).catch(() => undefined);
    },
    async listDevices(currentDeviceId) {
      const devices = await load();
      return devices
        .map((device) => toDevice(device, currentDeviceId))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    renameDevice: (id, name) =>
      transaction(async () => {
        const devices = await load();
        if (!devices.some((device) => device.id === id)) throw new AppError("not_found", `No device ${id}.`);
        await save(devices.map((device) => (device.id === id ? { ...device, name } : device)));
        deps.announce();
      }),
    revokeDevice: (id) =>
      transaction(async () => {
        const devices = await load();
        if (!devices.some((device) => device.id === id)) return;
        await save(devices.filter((device) => device.id !== id));
        deps.announce();
      }),
    signOutAll: () =>
      transaction(async () => {
        await save((await load()).filter((device) => device.kind === "node"));
        deps.announce();
      }),
    async mintPairing({ kind = "device", name }) {
      const entry = codes.mint(kind);
      const url = deps.remoteUrl();
      const ownNodeId = deps.nodeId?.();
      return {
        kind,
        code: entry.code,
        shortCode: entry.shortCode,
        link:
          url === null ? null : pairingLink(url, entry.code, name, kind === "node" ? ownNodeId : undefined),
        expiresAt: entry.expiresAt,
        ...(ownNodeId ? { nodeId: ownNodeId } : {}),
      };
    },
    redeemPairing: redeem,
    bindNodeIdentity: (deviceId, identity) => transaction(() => bindIdentity(deviceId, identity)),
    async findNodeDevice(nodeId) {
      const found = (await load()).find((entry) => entry.kind === "node" && entry.nodeId === nodeId);
      return found ? toDevice(found) : undefined;
    },
    clearAll: () =>
      transaction(async () => {
        codes.clear();
        await save([]);
        deps.announce();
      }),
  };
}
