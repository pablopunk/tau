import type { FastifyInstance, FastifyRequest } from "fastify";

const SAMPLE_INTERVAL_MS = 10_000;
const MAX_SAMPLES = 360;
const MAX_ROUTES = 128;
const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000];

interface CpuTime {
  user: number;
  system: number;
}

interface Memory {
  rss: number;
  heapUsed: number;
  external: number;
}

export interface MetricsClock {
  readonly wall: () => number;
  readonly monotonic: () => number;
  readonly cpu: () => CpuTime;
  readonly memory: () => Memory;
}

const systemClock: MetricsClock = {
  wall: Date.now,
  monotonic: () => performance.now(),
  cpu: () => process.cpuUsage(),
  memory: () => process.memoryUsage(),
};

interface Sample {
  readonly at: number;
  readonly intervalMs: number;
  readonly cpuPercent: number;
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly externalBytes: number;
  readonly timerLagMs: number;
}

interface RouteStats {
  readonly method: string;
  readonly route: string;
  count: number;
  errors: number;
  sumMs: number;
  maxMs: number;
  readonly buckets: number[];
}

const round = (value: number) => Math.round(value * 100) / 100;

function percentile(stats: RouteStats): number {
  const target = Math.ceil(stats.count * 0.95);
  let seen = 0;
  for (const [index, count] of stats.buckets.entries()) {
    seen += count;
    if (seen >= target) return LATENCY_BUCKETS_MS[index] ?? stats.maxMs;
  }
  return stats.maxMs;
}

/** Bounded, local process and REST measurements; no request body, raw URL, or credential is retained. */
export function createMetricsCollector(clock: MetricsClock = systemClock) {
  const since = clock.wall();
  const samples: Sample[] = [];
  const routes = new Map<string, RouteStats>();
  let lastCpu = clock.cpu();
  let lastTick = clock.monotonic();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const sample = () => {
    const at = clock.wall();
    const now = clock.monotonic();
    const intervalMs = Math.max(1, now - lastTick);
    const cpu = clock.cpu();
    const memory = clock.memory();
    const cpuMs = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1_000;
    samples.push({
      at,
      intervalMs: round(intervalMs),
      cpuPercent: round(Math.max(0, (cpuMs / intervalMs) * 100)),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      timerLagMs: round(Math.max(0, intervalMs - SAMPLE_INTERVAL_MS)),
    });
    if (samples.length > MAX_SAMPLES) samples.shift();
    lastCpu = cpu;
    lastTick = now;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      sample();
      schedule();
    }, SAMPLE_INTERVAL_MS);
    timer.unref?.();
  };

  const record = (method: string, route: string, durationMs: number, status: number) => {
    const known = `${method} ${route}`;
    const key = routes.has(known) || routes.size < MAX_ROUTES - 1 ? known : "OTHER <overflow>";
    let stats = routes.get(key);
    if (!stats) {
      const [name, ...parts] = key.split(" ");
      stats = {
        method: name ?? "OTHER",
        route: parts.join(" "),
        count: 0,
        errors: 0,
        sumMs: 0,
        maxMs: 0,
        buckets: Array.from({ length: LATENCY_BUCKETS_MS.length + 1 }, () => 0),
      };
      routes.set(key, stats);
    }
    const elapsed = Math.max(0, durationMs);
    stats.count += 1;
    if (status >= 400) stats.errors += 1;
    stats.sumMs += elapsed;
    stats.maxMs = Math.max(stats.maxMs, elapsed);
    const bucket = LATENCY_BUCKETS_MS.findIndex((limit) => elapsed <= limit);
    const bucketIndex = bucket < 0 ? LATENCY_BUCKETS_MS.length : bucket;
    stats.buckets[bucketIndex] = (stats.buckets[bucketIndex] ?? 0) + 1;
  };

  return {
    start: schedule,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    sample,
    record,
    snapshot() {
      return {
        scope: "local" as const,
        since,
        intervalMs: SAMPLE_INTERVAL_MS,
        samples: [...samples],
        requests: [...routes.values()].map((stats) => ({
          method: stats.method,
          route: stats.route,
          count: stats.count,
          errors: stats.errors,
          meanMs: round(stats.sumMs / stats.count),
          p95Ms: round(percentile(stats)),
          maxMs: round(stats.maxMs),
        })),
      };
    },
  };
}

/** Observe all REST outcomes, including guard failures, but never store the raw request URL. */
export function registerMetricsHooks(
  app: FastifyInstance,
  collector: ReturnType<typeof createMetricsCollector>,
) {
  const started = new WeakMap<FastifyRequest, number>();
  app.addHook("onRequest", (request, _reply, done) => {
    started.set(request, performance.now());
    done();
  });
  app.addHook("onResponse", (request, reply, done) => {
    const began = started.get(request);
    const template = request.routeOptions.url;
    if (began !== undefined && template?.startsWith("/api/") && template !== "/api/metrics") {
      collector.record(request.method, template, performance.now() - began, reply.statusCode);
    }
    done();
  });
}
