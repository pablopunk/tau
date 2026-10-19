import type { DeviceKind } from "@tau/protocol";

/** One line of `<home>/devices.json`. The secret is never stored, only `sha256(secret)` as hex. */
export interface StoredDevice {
  readonly id: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly secretHash: string;
  readonly os?: string;
  readonly tauVersion?: string;
  readonly protocolVersion?: string;
  /** A node device: the peer's `nodeId` and raw public key, stored at its first verified `hello`. */
  readonly nodeId?: string;
  readonly publicKey?: string;
}

/** Atomic, mode 0600 in the real one (owner A). */
export interface DeviceStore {
  read(): Promise<StoredDevice[]>;
  write(devices: readonly StoredDevice[]): Promise<void>;
}

export interface AccessDeps {
  readonly store: DeviceStore;
  readonly now: () => number;
  /** Cryptographically random bytes; tests pass a counter. */
  readonly randomBytes: (size: number) => Buffer;
  /** `https://<hostname>` while remote is on, else `null`; builds the pairing link. */
  readonly remoteUrl: () => string | null;
  readonly announce: () => void;
  /** This node's own `nodeId` (the pairing link and the redeem response carry it); absent in tests. */
  readonly nodeId?: () => string | undefined;
}
