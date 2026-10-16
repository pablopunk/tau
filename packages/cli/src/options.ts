import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

export interface CliOptions {
  readonly port: number;
  readonly open: boolean;
  readonly home: string;
  readonly faux: boolean;
}

export const DEFAULT_PORT = 4317;

const MAX_PORT = 65535;

export const defaultHome = (): string => join(homedir(), ".pi-everywhere");

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`Invalid --port: ${raw}`);
  }
  return port;
}

export function parseCliOptions(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
      home: { type: "string" },
      faux: { type: "boolean", default: false },
    },
  });
  return {
    port: parsePort(values.port),
    open: !values["no-open"],
    home: values.home ?? env.PI_EVERYWHERE_HOME ?? defaultHome(),
    faux: values.faux || env.PI_EVERYWHERE_FAUX === "1",
  };
}
