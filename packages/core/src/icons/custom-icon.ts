import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function customIconPath(directory: string, projectId: string): string {
  if (!SAFE_ID.test(projectId)) throw new Error("Unsafe project id.");
  return join(directory, `${projectId}.png`);
}

export async function readCustomIcon(directory: string, projectId: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(customIconPath(directory, projectId)));
  } catch {
    return null;
  }
}

export async function writeCustomIcon(directory: string, projectId: string, png: Uint8Array): Promise<void> {
  const path = customIconPath(directory, projectId);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, png, { mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function deleteCustomIcon(directory: string, projectId: string): Promise<void> {
  await rm(customIconPath(directory, projectId), { force: true });
}

export function hashIcon(png: Uint8Array): string {
  return createHash("sha1").update(png).digest("hex").slice(0, 12);
}
