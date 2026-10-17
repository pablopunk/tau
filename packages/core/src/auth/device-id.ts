import { randomUUID } from "node:crypto";
import { readFileIfPresent, writeFileAtomic } from "../home/atomic-write";

const isStoredId = (text: string | undefined): text is string => text !== undefined && text.trim() !== "";

/** The stable id of this installation: created once, then read back on every later call. */
export async function readOrCreateDeviceId(file: string): Promise<string> {
  const stored = await readFileIfPresent(file);
  if (isStoredId(stored)) return stored.trim();
  const created = randomUUID();
  await writeFileAtomic(file, `${created}\n`);
  return created;
}
