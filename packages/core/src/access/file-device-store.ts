import { Type } from "typebox";
import { Value } from "typebox/value";
import { readFileIfPresent, writeFileAtomic } from "../home/atomic-write";
import type { DeviceStore, StoredDevice } from "./ports";

const StoredDeviceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  kind: Type.Union([
    Type.Literal("browser"),
    Type.Literal("phone"),
    Type.Literal("cli"),
    Type.Literal("machine"), // stays "machine" until MVP13 Step 1
  ]),
  createdAt: Type.Number(),
  lastSeenAt: Type.Number(),
  secretHash: Type.String(),
  os: Type.Optional(Type.String()),
  tauVersion: Type.Optional(Type.String()),
  protocolVersion: Type.Optional(Type.String()),
});

function parse(text: string | undefined): StoredDevice[] {
  if (text === undefined) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((item): item is StoredDevice => Value.Check(StoredDeviceSchema, item))
      : [];
  } catch {
    return [];
  }
}

/** `<home>/devices.json`, mode 0600, written atomically. */
export function createFileDeviceStore(file: string): DeviceStore {
  return {
    read: async () => parse(await readFileIfPresent(file)),
    write: (devices) => writeFileAtomic(file, `${JSON.stringify(devices, null, 2)}\n`),
  };
}
