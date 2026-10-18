import { createHash, randomBytes } from "node:crypto";
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
} from "@tau/protocol";

export type FakeAccess = Core["access"] & {
  /** Removes every device and machine, as a new URL or remote off does. */
  clearAll(): Promise<void>;
};

export interface FakeAccessOptions {
  readonly now: () => number;
  readonly emit: (change: Change) => void;
  /** `https://<hostname>` while remote is on. */
  readonly remoteUrl: () => string | null;
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

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function shortCodeOf(): string {
  return [...randomBytes(8)].map((byte) => SHORT_ALPHABET[byte % SHORT_ALPHABET.length]).join("");
}

function kindForName(name: string): DeviceKind {
  return /iphone|android|mobile/i.test(name) ? "phone" : "browser";
}

/** A working in-memory access store: codes, devices, per-peer limits, throttled touch. */
export function createFakeAccess({ now, emit, remoteUrl }: FakeAccessOptions): FakeAccess {
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
  const find = (secret: string, machine: boolean) => {
    const hash = sha256(secret);
    return [...devices.values()].find(
      (entry) => entry.secretHash === hash && (entry.device.kind === "machine") === machine,
    );
  };
  return {
    async verifyDevice(secret) {
      const entry = find(secret, false);
      return entry ? { deviceId: entry.device.id } : undefined;
    },
    async verifyMachine(secret) {
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
          current: device.kind !== "machine" && device.id === currentDeviceId,
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
      for (const [id, { device }] of [...devices]) if (device.kind !== "machine") devices.delete(id);
      announce();
    },
    async mintPairing({ kind = "device" }): Promise<MintedPairing> {
      const code = randomBytes(16).toString("hex");
      const entry: Pending = { kind, code, shortCode: shortCodeOf(), expiresAt: now() + PAIRING_TTL_MS };
      const live = livePairings();
      live.push(entry);
      while (live.length > MAX_LIVE_PAIRINGS) live.shift();
      const url = remoteUrl();
      return {
        kind,
        code,
        shortCode: entry.shortCode,
        link: url === null ? null : `${url}/pair#${code}`,
        expiresAt: entry.expiresAt,
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
      const secret = randomBytes(32).toString("hex");
      const kind: DeviceKind = found.kind === "machine" ? "machine" : kindForName(deviceName);
      const id = `device-${++counter}`;
      const at = now();
      devices.set(id, {
        device: { id, name: deviceName || "Unnamed device", kind, createdAt: at, lastSeenAt: at },
        secretHash: sha256(secret),
      });
      announce();
      return { deviceId: id, kind: found.kind, secret };
    },
    async clearAll() {
      devices.clear();
      pending.length = 0;
      announce();
    },
  };
}
