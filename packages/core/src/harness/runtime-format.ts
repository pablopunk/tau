import { AppError } from "@tau/protocol";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

export const RUNTIME_FORMAT_FILE = "runtime-format.json";

export const RuntimeFormatManifestSchema = Type.Object({
  formatVersion: Type.Integer({ minimum: 1 }),
  requiredCapabilities: Type.Array(Type.String()),
  writtenAt: Type.Number(),
});
export type RuntimeFormatManifest = Static<typeof RuntimeFormatManifestSchema>;

export interface RuntimeFormatReader {
  formatVersion: number;
  capabilities: readonly string[];
}

export const CURRENT_FORMAT = { formatVersion: 1, capabilities: [] as readonly string[] };
export const READER_FLOOR: RuntimeFormatReader = CURRENT_FORMAT;

export type RuntimeFormatCheck =
  | { ok: true; native: boolean }
  | { ok: false; reason: "corrupt" | "newer-format" | "missing-capability"; detail: string };

function missingCapabilities(manifest: RuntimeFormatManifest, reader: RuntimeFormatReader): string[] {
  return manifest.requiredCapabilities.filter((capability) => !reader.capabilities.includes(capability));
}

export function checkRuntimeFormat(manifest: unknown, reader: RuntimeFormatReader): RuntimeFormatCheck {
  if (manifest === undefined) return { ok: true, native: false };
  if (!Value.Check(RuntimeFormatManifestSchema, manifest)) {
    return { ok: false, reason: "corrupt", detail: "The runtime format manifest has an invalid shape." };
  }
  if (manifest.formatVersion > reader.formatVersion) {
    return {
      ok: false,
      reason: "newer-format",
      detail: `The store uses format ${manifest.formatVersion}; this build reads up to ${reader.formatVersion}.`,
    };
  }
  const missing = missingCapabilities(manifest, reader);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "missing-capability",
      detail: `Missing capabilities: ${missing.join(", ")}.`,
    };
  }
  return { ok: true, native: true };
}

export function formatForwardGuard(manifest: unknown, reader: RuntimeFormatReader): void {
  const check = checkRuntimeFormat(manifest, reader);
  if (check.ok) return;
  throw new AppError("forbidden", `Runtime store format refused (${check.reason}): ${check.detail}`);
}
