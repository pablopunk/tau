import { realpathSync } from "node:fs";
import { compiled, type RuntimeProbe, stableBinary } from "./runtime/install-paths";

/** How to start tau again: `{ stableBinary, [] }` when compiled, `{ node, [entry] }` from a dev checkout or the Node build. */
export interface CliCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** The command for the service unit and for core's `<home>/bin/tau` shim. */
export function cliEntry(
  argv: readonly string[] = process.argv,
  execPath: string = process.execPath,
  probe?: RuntimeProbe,
): CliCommand {
  if (compiled(probe)) return { command: stableBinary(probe), args: [] };
  const started = argv[1];
  if (started === undefined) throw new Error("Cannot tell which file started tau");
  return { command: execPath, args: [realpathSync(started)] };
}
