import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PORT } from "../options";

const portFileOf = (home: string) => join(home, "port");

export function readStoredPort(home: string): number | undefined {
  try {
    const port = Number(readFileSync(portFileOf(home), "utf8").trim());
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredPort(home: string, port: number): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(portFileOf(home), `${port}\n`);
}

/** `--port` wins and is stored; otherwise the stored port; otherwise the default. */
export function resolvePort(home: string, explicitPort: number | undefined): number {
  if (explicitPort !== undefined) {
    writeStoredPort(home, explicitPort);
    return explicitPort;
  }
  return readStoredPort(home) ?? DEFAULT_PORT;
}
