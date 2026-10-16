import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const MAX_ATTEMPTS = 1000;

/** Creates `<parent>/<base>` (or `<base>-2`, `-3` …) with a non-recursive mkdir, so only one caller can own it. */
export async function claimFolder(parent: string, base: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const path = join(parent, attempt === 1 ? base : `${base}-${attempt}`);
    try {
      await mkdir(path);
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not claim a folder for ${base}`);
}
