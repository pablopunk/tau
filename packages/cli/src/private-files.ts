import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
}

/** Temp file, then rename, so readers never see a half-written file. */
export async function writePrivateFile(path: string, content: string): Promise<void> {
  await ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: PRIVATE_FILE_MODE });
  await rename(temporary, path);
}
