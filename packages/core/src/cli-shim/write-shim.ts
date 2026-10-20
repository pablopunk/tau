import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SHIM_MODE = 0o755;

const quoted = (path: string) => `"${path.replace(/(["\\$`])/g, "\\$1")}"`;

export interface ShimCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export const shimScript = ({ command, args }: ShimCommand) =>
  `#!/bin/sh\nexec ${[command, ...args].map(quoted).join(" ")} "$@"\n`;

/** Only the process that holds the home lock calls this. */
export async function writeTauShim(home: string, cli: ShimCommand): Promise<string> {
  const directory = join(home, "bin");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "tau");
  await writeFile(file, shimScript(cli), { mode: SHIM_MODE });
  await chmod(file, SHIM_MODE);
  return file;
}
