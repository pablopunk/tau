import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writePrivateFile } from "./private-files";

const TOKEN_BYTES = 32;
const MIN_TOKEN_LENGTH = 32;

const tokenPath = (home: string) => join(home, "token");

async function readExistingToken(home: string): Promise<string | undefined> {
  try {
    const token = (await readFile(tokenPath(home), "utf8")).trim();
    return token.length >= MIN_TOKEN_LENGTH ? token : undefined;
  } catch {
    return undefined;
  }
}

/** The token outlives restarts so open browser tabs keep their cookie. */
export async function readOrCreateToken(home: string): Promise<string> {
  const existing = await readExistingToken(home);
  if (existing) return existing;
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await writePrivateFile(tokenPath(home), `${token}\n`);
  return token;
}
