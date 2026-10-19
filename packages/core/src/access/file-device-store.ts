import { Type } from "typebox";
import { Value } from "typebox/value";
import { readFileIfPresent, writeFileAtomic } from "../home/atomic-write";
import type { DeviceStore, StoredDevice } from "./ports";

/**
 * On disk a node device is still `"machine"` for one release (a 0.1.x tau silently drops an unknown kind,
 * so a downgrade would lose the link). The reader accepts both literals; the writer writes `"machine"`.
 * Extra optional fields (`nodeId`, `publicKey`) are tolerated by 0.1.x.
 */
const StoredDeviceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  kind: Type.Union([
    Type.Literal("browser"),
    Type.Literal("phone"),
    Type.Literal("cli"),
    Type.Literal("machine"),
    Type.Literal("node"),
  ]),
  createdAt: Type.Number(),
  lastSeenAt: Type.Number(),
  secretHash: Type.String(),
  os: Type.Optional(Type.String()),
  tauVersion: Type.Optional(Type.String()),
  protocolVersion: Type.Optional(Type.String()),
  nodeId: Type.Optional(Type.String()),
  publicKey: Type.Optional(Type.String()),
});
type DiskDevice = Type.Static<typeof StoredDeviceSchema>;

const fromDisk = (device: DiskDevice): StoredDevice => ({
  ...device,
  kind: device.kind === "machine" ? "node" : device.kind,
});
const toDisk = (device: StoredDevice): DiskDevice => ({
  ...device,
  kind: device.kind === "node" ? "machine" : device.kind,
});

function parse(text: string | undefined): StoredDevice[] {
  if (text === undefined) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((item): item is DiskDevice => Value.Check(StoredDeviceSchema, item)).map(fromDisk)
      : [];
  } catch {
    return [];
  }
}

/** `<home>/devices.json`, mode 0600, written atomically. */
export function createFileDeviceStore(file: string): DeviceStore {
  return {
    read: async () => parse(await readFileIfPresent(file)),
    write: (devices) => writeFileAtomic(file, `${JSON.stringify(devices.map(toDisk), null, 2)}\n`),
  };
}
