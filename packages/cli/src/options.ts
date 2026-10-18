import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

export interface CliOptions {
  readonly port: number;
  readonly open: boolean;
  readonly home: string;
  readonly faux: boolean;
  /** Set by the service manager: never exit because another instance holds the lock. */
  readonly service: boolean;
}

export const DEFAULT_PORT = 4317;

const MAX_PORT = 65535;

export const defaultHome = (): string => join(homedir(), ".tau");

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`Invalid --port: ${raw}`);
  }
  return port;
}

const SERVER_FLAGS = {
  port: { type: "string" },
  "no-open": { type: "boolean", default: false },
  home: { type: "string" },
  faux: { type: "boolean", default: false },
  service: { type: "boolean", default: false },
} as const;

/** The server flags of `serve` and `start`: `--port`, `--home`, `--faux`, `--no-open`, `--service`. */
export function parseCliOptions(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const { values } = parseArgs({ args: [...argv], options: SERVER_FLAGS });
  return {
    port: parsePort(values.port),
    open: !values["no-open"],
    home: values.home ?? env.TAU_HOME ?? defaultHome(),
    faux: values.faux || env.TAU_FAUX === "1",
    service: values.service,
  };
}

/** The command word (the first positional) and the argv without it. Unknown flags do not stop the scan. */
export function commandWordOf(argv: readonly string[]): {
  word: string | undefined;
  rest: readonly string[];
} {
  const { positionals } = parseArgs({
    args: [...argv],
    options: SERVER_FLAGS,
    allowPositionals: true,
    strict: false,
  });
  const word = positionals[0];
  if (word === undefined) return { word, rest: argv };
  const index = argv.indexOf(word);
  return { word, rest: [...argv.slice(0, index), ...argv.slice(index + 1)] };
}
