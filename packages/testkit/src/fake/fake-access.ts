import {
  AppError,
  type Change,
  type Core,
  type Device,
  type DeviceKind,
  MAX_LIVE_PAIRINGS,
  type MintedPairing,
  PAIRING_TTL_MS,
  type PairingKind,
  pairingLink,
} from "@tau/protocol";

export type FakeAccess = Core["access"] & {
  /** Removes every device and node, as a new URL or remote off does. */
  clearAll(): Promise<void>;
  /** Adds a node device without a pairing code (the fake hub's seeded nodes). */
  addNodeDevice(name: string, nodeId?: string): { id: string; secret: string };
};

export interface FakeAccessOptions {
  readonly now: () => number;
  readonly emit: (change: Change) => void;
  /** `https://<hostname>` while remote is on. */
  readonly remoteUrl: () => string | null;
  /** This fake's own `nodeId`, carried by node pairings. */
  readonly nodeId?: () => string;
}

interface Stored {
  device: Omit<Device, "current">;
  secretHash: string;
}

interface Pending {
  readonly kind: PairingKind;
  readonly code: string;
  readonly shortCode: string;
  readonly expiresAt: number;
}

const SHORT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PEER_FAILURE_LIMIT = 5;
const PEER_WINDOW_MS = 60_000;
const PEER_LOCK_MS = 10 * 60_000;
const TOUCH_THROTTLE_MS = 60_000;
const WRONG_CODE = "That code did not work.";

/** Browser-safe random hex (this is a fake: no secrets are protected). */
function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** A tiny non-cryptographic hash (FNV-1a, twice): enough for a fake store. */
function sha256(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < value.length; index++) {
    a = Math.imul(a ^ value.charCodeAt(index), 0x01000193) >>> 0;
    b = Math.imul(b + value.charCodeAt(index), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16)}${b.toString(16)}`;
}

function shortCodeOf(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (byte) => SHORT_ALPHABET[byte % SHORT_ALPHABET.length],
  ).join("");
}

function kindForName(name: string): DeviceKind {
  return /iphone|android|mobile/i.test(name) ? "phone" : "browser";
}

/** A working in-memory access store: codes, devices, per-peer limits, throttled touch. */
export function createFakeAccess({ now, emit, remoteUrl, nodeId: ownNodeId }: FakeAccessOptions): FakeAccess {
  const devices = new Map<string, Stored>();
  const pending: Pending[] = [];
  const failures = new Map<string, { at: number[]; lockedUntil: number }>();
  let counter = 0;
  const announce = () => emit({ resource: "devices" });
  const livePairings = () => {
    const alive = pending.filter((entry) => entry.expiresAt > now());
    pending.splice(0, pending.length, ...alive);
    return pending;
  };
  const isLocked = (peer: string) => (failures.get(peer)?.lockedUntil ?? 0) > now();
  const recordFailure = (peer: string) => {
    const record = failures.get(peer) ?? { at: [], lockedUntil: 0 };
    record.at = [...record.at.filter((time) => now() - time < PEER_WINDOW_MS), now()];
    if (record.at.length >= PEER_FAILURE_LIMIT) record.lockedUntil = now() + PEER_LOCK_MS;
    failures.set(peer, record);
  };
  const find = (secret: string, node: boolean) => {
    const hash = sha256(secret);
    return [...devices.values()].find(
      (entry) => entry.secretHash === hash && (entry.device.kind === "node") === node,
    );
  };
  return {
    async verifyDevice(secret) {
      const entry = find(secret, false);
      return entry ? { deviceId: entry.device.id } : undefined;
    },
    async verifyNode(secret) {
      const entry = find(secret, true);
      return entry ? { deviceId: entry.device.id } : undefined;
    },
    touch(deviceId) {
      const entry = devices.get(deviceId);
      if (!entry || now() - entry.device.lastSeenAt < TOUCH_THROTTLE_MS) return;
      entry.device = { ...entry.device, lastSeenAt: now() };
    },
    async listDevices(currentDeviceId) {
      return [...devices.values()]
        .map(({ device }) => ({
          ...device,
          current: device.kind !== "node" && device.id === currentDeviceId,
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async renameDevice(id, name) {
      const entry = devices.get(id);
      if (!entry) throw new AppError("not_found", `No device ${id}.`);
      entry.device = { ...entry.device, name };
      announce();
    },
    async revokeDevice(id) {
      if (devices.delete(id)) announce();
    },
    async signOutAll() {
      for (const [id, { device }] of [...devices]) if (device.kind !== "node") devices.delete(id);
      announce();
    },
    async rotate({ keep, callerDeviceId }) {
      const kept = new Set([...keep, ...(callerDeviceId ? [callerDeviceId] : [])]);
      const revoked = [...devices.values()]
        .filter(({ device }) => !kept.has(device.id))
        .map(({ device: { id, name, kind } }) => ({ id, name, kind }));
      for (const { id } of revoked) devices.delete(id);
      if (revoked.length > 0) announce();
      return revoked;
    },
    async mintPairing({ kind = "device", name }): Promise<MintedPairing> {
      const code = randomHex(16);
      const entry: Pending = { kind, code, shortCode: shortCodeOf(), expiresAt: now() + PAIRING_TTL_MS };
      const live = livePairings();
      live.push(entry);
      while (live.length > MAX_LIVE_PAIRINGS) live.shift();
      const url = remoteUrl();
      return {
        kind,
        code,
        shortCode: entry.shortCode,
        link: url === null ? null : pairingLink(url, code, name, kind === "node" ? ownNodeId?.() : undefined),
        expiresAt: entry.expiresAt,
        ...(ownNodeId ? { nodeId: ownNodeId() } : {}),
      };
    },
    async redeemPairing({ code, deviceName, peer }) {
      if (isLocked(peer)) throw new AppError("unauthorized", WRONG_CODE);
      const wanted = code.trim();
      const index = livePairings().findIndex(
        (entry) => entry.code === wanted || entry.shortCode === wanted.toUpperCase(),
      );
      const found = pending[index];
      if (!found) {
        recordFailure(peer);
        throw new AppError("unauthorized", WRONG_CODE);
      }
      pending.splice(index, 1);
      const secret = randomHex(32);
      const kind: DeviceKind = found.kind === "node" ? "node" : kindForName(deviceName);
      const id = `device-${++counter}`;
      const at = now();
      devices.set(id, {
        device: { id, name: deviceName || "Unnamed device", kind, createdAt: at, lastSeenAt: at },
        secretHash: sha256(secret),
      });
      announce();
      const nodeId = found.kind === "node" ? ownNodeId?.() : undefined;
      return { deviceId: id, kind: found.kind, secret, ...(nodeId ? { nodeId } : {}) };
    },
    addNodeDevice(name, nodeId) {
      const secret = randomHex(32);
      const id = `device-${++counter}`;
      const at = now();
      devices.set(id, {
        device: { id, name, kind: "node", createdAt: at, lastSeenAt: at, ...(nodeId ? { nodeId } : {}) },
        secretHash: sha256(secret),
      });
      return { id, secret };
    },
    async clearAll() {
      devices.clear();
      pending.length = 0;
      announce();
    },
  };
}
