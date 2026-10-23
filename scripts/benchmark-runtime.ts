/**
 * Offline, deterministic latency evidence for the Pi and native Claude runtime paths (overhead only).
 *
 *   tsx scripts/benchmark-runtime.ts --offline --config e2e/runtime-benchmark.config.json --output test-artifacts/runtime-benchmark.json [--samples N] [--concurrency 1|4]
 *
 * Pi runs on the faux provider; native runs the real Claude Agent SDK under sandbox-exec against a loopback fake API (macOS only).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type BenchmarkArgs,
  parseBenchmarkArgs,
  UsageError,
} from "../packages/core/src/runtimes/benchmark/args";
import type { CellMeasurement } from "../packages/core/src/runtimes/benchmark/cell";
import {
  type BenchmarkConfig,
  ConfigError,
  configHash,
  parseConfig,
} from "../packages/core/src/runtimes/benchmark/config";
import { environmentFingerprint } from "../packages/core/src/runtimes/benchmark/environment";
import { buildReport, renderSummary } from "../packages/core/src/runtimes/benchmark/report";
import { runCell } from "../packages/core/src/runtimes/benchmark/run-cell";

async function loadConfig(path: string): Promise<BenchmarkConfig> {
  return parseConfig(JSON.parse(await readFile(path, "utf8")));
}

function concurrencyOf(args: BenchmarkArgs, config: BenchmarkConfig): (1 | 4)[] {
  const chosen = config.concurrency.filter(
    (value) => args.concurrency === undefined || value === args.concurrency,
  );
  if (chosen.length === 0)
    throw new UsageError(
      `--concurrency ${args.concurrency} is not in the config (${config.concurrency.join(", ")}).`,
    );
  return chosen;
}

async function measureAll(config: BenchmarkConfig, samples: number, concurrency: readonly (1 | 4)[]) {
  const measurements: CellMeasurement[] = [];
  for (const executor of config.executors) {
    for (const level of concurrency) {
      console.error(`measuring ${executor} x${level} (${samples} samples, ${config.warmup} warmup)`);
      measurements.push(
        await runCell({
          executor,
          concurrency: level,
          samples,
          warmup: config.warmup,
          sampleTimeoutMs: config.sampleTimeoutMs,
          idleCpuWindowMs: config.idleCpuWindowMs,
          fixtureRepo: config.fixtureRepo,
        }),
      );
    }
  }
  return measurements;
}

async function main(): Promise<number> {
  const args = parseBenchmarkArgs(process.argv.slice(2));
  const configPath = resolve(args.configPath);
  const config = await loadConfig(configPath);
  const samples = args.samples ?? config.samples;
  const concurrency = concurrencyOf(args, config);
  const report = buildReport({
    config,
    configPath: args.configPath,
    effective: { samples, concurrency },
    environment: environmentFingerprint(configHash(config)),
    measurements: await measureAll(config, samples, concurrency),
    now: new Date(),
  });
  const outputPath = resolve(args.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(renderSummary(report));
  console.log(`Wrote ${args.outputPath}`);
  return report.verdict === "PASS" ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const known = error instanceof UsageError || error instanceof ConfigError;
    console.error(known ? (error as Error).message : error);
    process.exit(known ? 2 : 1);
  },
);
