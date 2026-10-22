import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetricsCollector, type MetricsClock } from "./collector";

function fixture() {
  let at = 1_000;
  let elapsed = 0;
  let user = 0;
  let system = 0;
  let rss = 100;
  const clock: MetricsClock = {
    wall: () => at,
    monotonic: () => elapsed,
    cpu: () => ({ user, system }),
    memory: () => ({ rss, heapUsed: 40, external: 10 }),
  };
  return {
    collector: createMetricsCollector(clock),
    advance(ms: number, userMicros: number, systemMicros = 0) {
      at += ms;
      elapsed += ms;
      user += userMicros;
      system += systemMicros;
      rss += 1;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("local metrics collector", () => {
  it("reports interval CPU, memory and scheduler lag without assuming one-core CPU <= 100%", () => {
    const { collector, advance } = fixture();
    advance(10_000, 12_000_000, 3_000_000);
    collector.sample();
    expect(collector.snapshot()).toMatchObject({
      scope: "local",
      since: 1_000,
      intervalMs: 10_000,
      samples: [
        {
          at: 11_000,
          intervalMs: 10_000,
          cpuPercent: 150,
          rssBytes: 101,
          heapUsedBytes: 40,
          externalBytes: 10,
          timerLagMs: 0,
        },
      ],
    });
    advance(12_000, 0);
    collector.sample();
    expect(collector.snapshot().samples[1]).toMatchObject({ cpuPercent: 0, timerLagMs: 2_000 });
  });

  it("bounds samples and route dimensions, counts errors, and uses bounded latency buckets", () => {
    const { collector, advance } = fixture();
    for (let i = 0; i < 365; i++) {
      advance(10_000, 1_000);
      collector.sample();
    }
    expect(collector.snapshot().samples).toHaveLength(360);
    expect(collector.snapshot().samples[0]?.at).toBe(61_000);

    for (let i = 0; i < 20; i++) collector.record("GET", "/api/conversations/:id", 80, i === 0 ? 500 : 200);
    expect(collector.snapshot().requests[0]).toEqual({
      method: "GET",
      route: "/api/conversations/:id",
      count: 20,
      errors: 1,
      meanMs: 80,
      p95Ms: 100,
      maxMs: 80,
    });
    for (let i = 0; i < 130; i++) collector.record("GET", `/api/route-${i}`, 1, 200);
    expect(collector.snapshot().requests).toHaveLength(128);
    expect(collector.snapshot().requests.at(-1)).toMatchObject({ route: "<overflow>", count: 4 });
  });

  it("stops its unreferenced sampling timer on server shutdown", () => {
    vi.useFakeTimers();
    const { collector, advance } = fixture();
    collector.start();
    advance(10_000, 100_000);
    vi.advanceTimersByTime(10_000);
    expect(collector.snapshot().samples).toHaveLength(1);
    collector.stop();
    advance(10_000, 100_000);
    vi.advanceTimersByTime(10_000);
    expect(collector.snapshot().samples).toHaveLength(1);
  });
});
