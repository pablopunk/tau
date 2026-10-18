import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliOptions } from "./options";
import { defaultHome } from "./options";

export const legacyDefaultHome = (): string => join(homedir(), ".pi-everywhere");

/** Renames the old default data folder once; a custom `--home` is never touched. */
export async function migrateLegacyHome(options: CliOptions): Promise<void> {
  if (options.home !== defaultHome()) return;
  if (existsSync(options.home) || !existsSync(legacyDefaultHome())) return;
  await rename(legacyDefaultHome(), options.home);
}
