import { realpathSync } from "node:fs";

export interface CliEntry {
  /** Absolute path of the node binary running tau. */
  readonly node: string;
  /** Absolute, symlink-free path of the file that started tau. */
  readonly entry: string;
}

/** The node and entry paths for the service unit and for core's `<home>/bin/tau` shim. */
export function cliEntry(
  argv: readonly string[] = process.argv,
  execPath: string = process.execPath,
): CliEntry {
  const started = argv[1];
  if (started === undefined) throw new Error("Cannot tell which file started tau");
  return { node: execPath, entry: realpathSync(started) };
}
