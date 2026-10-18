import { AppError, type Core, type Device, type DeviceKind } from "@tau/protocol";
import { deviceKindFromName } from "./device-names";
import { createPairingCodes, looksLikeShortCode } from "./pairing-codes";
import type { AccessDeps, StoredDevice } from "./ports";
import { createRedeemLimits } from "./redeem-limits";
import { safeEqual, sha256Hex } from "./secrets";

/** What `Core.access` is, plus what the remote service needs when a URL dies. */
export type AccessService = Core["access"] & {
  /** Removes every device and machine (their cookies and links belong to the old host). */
  clearAll(): Promise<void>;
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
  const find = async (secret: string, machine: boolean) => {
    const hash = sha256Hex(secret);
    let found: StoredDevice | undefined;
    for (const device of await load()) {
      if (safeEqual(device.secretHash, hash) && (device.kind === "machine") === machine) found = device;
    }
    return found ? { deviceId: found.id } : undefined;
  };
  const toDevice = (device: StoredDevice, currentId?: string): Device => {
    const { secretHash: _hash, ...rest } = device;
    return { ...rest, current: device.kind !== "machine" && device.id === currentId };
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
    const kind: DeviceKind = pairing.kind === "machine" ? "machine" : deviceKindFromName(input.deviceName);
    const at = deps.now();
    const device: StoredDevice = {
      id: deps.randomBytes(8).toString("hex"),
      name: input.deviceName.trim() || "Unnamed device",
      kind,
      createdAt: at,
      lastSeenAt: at,
      secretHash: sha256Hex(secret),
    };
    await save([...(await load()), device]);
    deps.announce();
    return { deviceId: device.id, kind: pairing.kind, secret };
  }

  return {
    verifyDevice: (secret) => find(secret, false),
    verifyMachine: (secret) => find(secret, true),
    touch(deviceId) {
      void (async () => {
        const devices = await load();
        const device = devices.find((entry) => entry.id === deviceId);
        if (!device || deps.now() - device.lastSeenAt < TOUCH_THROTTLE_MS) return;
        await save(
          devices.map((entry) => (entry === device ? { ...device, lastSeenAt: deps.now() } : entry)),
        );
      })().catch(() => undefined);
    },
    async listDevices(currentDeviceId) {
      const devices = await load();
      return devices
        .map((device) => toDevice(device, currentDeviceId))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async renameDevice(id, name) {
      const devices = await load();
      if (!devices.some((device) => device.id === id)) throw new AppError("not_found", `No device ${id}.`);
      await save(devices.map((device) => (device.id === id ? { ...device, name } : device)));
      deps.announce();
    },
    async revokeDevice(id) {
      const devices = await load();
      if (!devices.some((device) => device.id === id)) return;
      await save(devices.filter((device) => device.id !== id));
      deps.announce();
    },
    async signOutAll() {
      await save((await load()).filter((device) => device.kind === "machine"));
      deps.announce();
    },
    async mintPairing({ kind = "device" }) {
      const entry = codes.mint(kind);
      const url = deps.remoteUrl();
      return {
        kind,
        code: entry.code,
        shortCode: entry.shortCode,
        link: url === null ? null : `${url}/pair#${entry.code}`,
        expiresAt: entry.expiresAt,
      };
    },
    redeemPairing: redeem,
    async clearAll() {
      codes.clear();
      await save([]);
      deps.announce();
    },
  };
}
