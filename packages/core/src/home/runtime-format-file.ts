import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CURRENT_FORMAT,
  formatForwardGuard,
  READER_FLOOR,
  RUNTIME_FORMAT_FILE,
  type RuntimeFormatManifest,
  type RuntimeFormatReader,
} from "../harness/runtime-format";
import { PRIVATE_FILE_MODE, readFileIfPresent } from "./atomic-write";

const UNREADABLE_MANIFEST = null;

export const runtimeFormatPath = (root: string): string => join(root, RUNTIME_FORMAT_FILE);

async function readManifest(root: string): Promise<unknown> {
  const text = await readFileIfPresent(runtimeFormatPath(root));
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return UNREADABLE_MANIFEST;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* a platform that cannot sync a directory still got the atomic rename */
  }
}

async function writeDurablyAndAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", PRIVATE_FILE_MODE);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  await syncDirectory(dirname(path));
}

const currentManifest = (now: number): RuntimeFormatManifest => ({
  formatVersion: CURRENT_FORMAT.formatVersion,
  requiredCapabilities: [...CURRENT_FORMAT.capabilities],
  writtenAt: now,
});

/** Startup, before the harness opens: refuses a store this build cannot read. An absent manifest is fine. */
export async function guardRuntimeFormatAtStartup(
  root: string,
  reader: RuntimeFormatReader = READER_FLOOR,
): Promise<void> {
  formatForwardGuard(await readManifest(root), reader);
}

/**
 * Before the first native record exists: writes the manifest when absent, never rewrites or downgrades an
 * existing one, and refuses a corrupt or newer one instead of overwriting it.
 */
export async function ensureRuntimeFormat(
  root: string,
  now: () => number,
  reader: RuntimeFormatReader = READER_FLOOR,
): Promise<void> {
  const existing = await readManifest(root);
  formatForwardGuard(existing, reader);
  if (existing !== undefined) return;
  await writeDurablyAndAtomically(runtimeFormatPath(root), `${JSON.stringify(currentManifest(now()))}\n`);
}
