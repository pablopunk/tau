import type { MetricsResponse } from "@tau/protocol";
import { CliExit, usageError } from "./cli-exit";
import { callRoute, discoverServer } from "./client";
import { type CommandEnv, processEnv } from "./command-env";

export const METRICS_USAGE = "Usage: tau metrics [--json] [--home <dir>]";

export function parseMetricsArgs(argv: readonly string[]): { json: boolean; home?: string; help: boolean } {
  let json = false;
  let home: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--home" && argv[i + 1] && !argv[i + 1]?.startsWith("-")) home = argv[++i];
    else if (arg?.startsWith("--home=") && arg.length > 7) home = arg.slice(7);
    else throw usageError(METRICS_USAGE);
  }
  return { json, home, help };
}

const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;

export function formatMetrics(metrics: MetricsResponse, now: number): string {
  const latest = metrics.samples.at(-1);
  const sample = latest
    ? `Latest sample (${Math.max(0, Math.round((now - latest.at) / 1000))}s ago, ${latest.intervalMs}ms interval): Tau process CPU ${latest.cpuPercent.toFixed(1)}%, RSS ${mib(latest.rssBytes)}, heap ${mib(latest.heapUsedBytes)}, external ${mib(latest.externalBytes)}, sampling timer lag ${latest.timerLagMs.toFixed(1)}ms`
    : "No samples yet";
  const requests = metrics.requests.length
    ? metrics.requests
        .map(
          (r) =>
            `  ${r.method} ${r.route}: ${r.count} requests, ${r.errors} errors, p95 up to ${r.p95Ms.toFixed(1)}ms (bucket upper bound)`,
        )
        .join("\n")
    : "  No requests yet";
  return `Local Tau-process metrics (since ${new Date(metrics.since).toISOString()}; in memory, resets on restart)\nCPU is percent of one core; child-process CPU and memory are not included. Samples are retained for up to 1 hour.\n${sample}\nRequests:\n${requests}`;
}

/** Fetches local, owner-only metrics. */
export async function executeMetrics(argv: readonly string[], env: CommandEnv): Promise<void> {
  const args = parseMetricsArgs(argv);
  if (args.help) return env.stdout(METRICS_USAGE);
  const scoped = args.home === undefined ? env : { ...env, home: args.home };
  const result = (await callRoute(await discoverServer(scoped), "getMetrics", {}, scoped)) as MetricsResponse;
  scoped.stdout(args.json ? JSON.stringify(result, null, 2) : formatMetrics(result, scoped.now()));
}

export async function runMetrics(argv: readonly string[]): Promise<void> {
  const env = processEnv();
  try {
    await executeMetrics(argv, env);
  } catch (error) {
    if (!(error instanceof CliExit)) throw error;
    env.stderr(error.message);
    process.exitCode = error.exitCode;
  }
}
