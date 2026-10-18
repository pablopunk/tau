import { runApiCommand } from "./run-command";

/**
 * `tau pair [--name <label>]`. Phase 0 stub: mints a code through the generic `pair new` command.
 * Owner E: enable remote when needed, print the link, the short code and a terminal QR, then wait for "Linked: …".
 */
export async function runPair(argv: readonly string[]): Promise<void> {
  await runApiCommand("pair", ["new", ...argv]);
}
