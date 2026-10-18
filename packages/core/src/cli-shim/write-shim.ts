import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SHIM_MODE = 0o755;

const quoted = (path: string) => `"${path.replace(/(["\\$`])/g, "\\$1")}"`;

export const shimScript = (node: string, cliEntry: string) =>
  `#!/bin/sh\nexec ${quoted(node)} ${quoted(cliEntry)} "$@"\n`;

/** Only the process that holds the home lock calls this. */
export async function writeTauShim(home: string, node: string, cliEntry: string): Promise<string> {
  const directory = join(home, "bin");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "tau");
  await writeFile(file, shimScript(node, cliEntry), { mode: SHIM_MODE });
  await chmod(file, SHIM_MODE);
  return file;
}
