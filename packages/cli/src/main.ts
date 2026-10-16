import { parseArgs } from "node:util";

export interface CliOptions {
  readonly port: number;
  readonly open: boolean;
  readonly home: string | undefined;
  readonly faux: boolean;
}

export const DEFAULT_PORT = 4317;

export function parseCliOptions(argv: readonly string[]): CliOptions {
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
    port: values.port ? Number(values.port) : DEFAULT_PORT,
    open: !values["no-open"],
    home: values.home ?? process.env.PI_EVERYWHERE_HOME,
    faux: values.faux || process.env.PI_EVERYWHERE_FAUX === "1",
  };
}

/** Stub: workstream B (server + CLI) wires createCore and createServer here. */
export async function main(argv: readonly string[]): Promise<void> {
  const options = parseCliOptions(argv);
  throw new Error(`pi-everywhere is not wired up yet (port ${options.port})`);
}
