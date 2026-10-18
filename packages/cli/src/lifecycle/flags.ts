import { parseArgs } from "node:util";

export interface LifecycleFlags {
  readonly home: string;
  /** Only set when the user typed `--port`. */
  readonly explicitPort: number | undefined;
  readonly open: boolean;
  readonly json: boolean;
  readonly follow: boolean;
}

/** What the flags fall back on: the machine's default home and its `TAU_HOME`. */
export interface HomeDefaults {
  readonly defaultHome: string;
  readonly env: NodeJS.ProcessEnv;
}

function portOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port: ${raw}`);
  return port;
}

/** The flags the lifecycle commands read; others (`--faux`) are left alone. */
export function lifecycleFlagsOf(argv: readonly string[], defaults: HomeDefaults): LifecycleFlags {
  const { values } = parseArgs({
    args: [...argv],
    strict: false,
    options: {
      home: { type: "string" },
      port: { type: "string" },
      "no-open": { type: "boolean" },
      json: { type: "boolean" },
      follow: { type: "boolean", short: "f" },
    },
  });
  return {
    home: typeof values.home === "string" ? values.home : (defaults.env.TAU_HOME ?? defaults.defaultHome),
    explicitPort: portOf(typeof values.port === "string" ? values.port : undefined),
    open: values["no-open"] !== true,
    json: values.json === true,
    follow: values.follow === true,
  };
}
