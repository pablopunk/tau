import { parseArgs } from "node:util";

export const DEFAULT_CONFIG_PATH = "e2e/runtime-benchmark.config.json";
export const DEFAULT_OUTPUT_PATH = "test-artifacts/runtime-benchmark.json";

export interface BenchmarkArgs {
  readonly configPath: string;
  readonly outputPath: string;
  readonly samples: number | undefined;
  readonly concurrency: 1 | 4 | undefined;
}

export class UsageError extends Error {}

const OFFLINE_REQUIRED =
  "Refusing to run without --offline: this tool only measures against the fake provider and fake API, never a paid provider.";

function positiveInteger(text: string, flag: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1)
    throw new UsageError(`${flag} needs a positive integer, got "${text}".`);
  return value;
}

function concurrencyOf(text: string): 1 | 4 {
  if (text === "1") return 1;
  if (text === "4") return 4;
  throw new UsageError(`--concurrency must be 1 or 4, got "${text}".`);
}

export function parseBenchmarkArgs(argv: readonly string[]): BenchmarkArgs {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      offline: { type: "boolean" },
      config: { type: "string" },
      output: { type: "string" },
      samples: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  if (values.offline !== true) throw new UsageError(OFFLINE_REQUIRED);
  return {
    configPath: values.config ?? DEFAULT_CONFIG_PATH,
    outputPath: values.output ?? DEFAULT_OUTPUT_PATH,
    samples: values.samples === undefined ? undefined : positiveInteger(values.samples, "--samples"),
    concurrency: values.concurrency === undefined ? undefined : concurrencyOf(values.concurrency),
  };
}
