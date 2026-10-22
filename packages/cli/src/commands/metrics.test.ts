import type { MetricsResponse } from "@tau/protocol";
import { describe, expect, it, vi } from "vitest";
import { EXIT_USAGE } from "./cli-exit";
import { formatMetrics, METRICS_USAGE, parseMetricsArgs } from "./metrics";

const response: MetricsResponse = {
  scope: "local",
  since: 1000,
  intervalMs: 5000,
  samples: [
    {
      at: 6000,
      intervalMs: 5000,
      cpuPercent: 12.5,
      rssBytes: 10485760,
      heapUsedBytes: 2097152,
      externalBytes: 1048576,
      timerLagMs: 1.2,
    },
  ],
  requests: [{ method: "GET", route: "/api/health", count: 9, errors: 2, meanMs: 3, p95Ms: 8, maxMs: 10 }],
};

describe("metrics CLI", () => {
  it("parses only supported flags", () => {
    expect(parseMetricsArgs(["--json", "--home", "/tmp/tau"])).toEqual({
      json: true,
      home: "/tmp/tau",
      help: false,
    });
    expect(parseMetricsArgs(["--help"])).toEqual({ json: false, home: undefined, help: true });
    for (const args of [["extra"], ["--bad"], ["--home"], ["--home="]]) {
      expect(() => parseMetricsArgs(args)).toThrow(METRICS_USAGE);
      try {
        parseMetricsArgs(args);
      } catch (error) {
        expect(error).toMatchObject({ exitCode: EXIT_USAGE });
      }
    }
  });

  it("renders the latest sample, age and request breakdown", () => {
    expect(formatMetrics(response, 9000)).toContain("3s ago");
    expect(formatMetrics(response, 9000)).toContain("Tau process CPU 12.5%, RSS 10.0 MiB");
    expect(formatMetrics(response, 9000)).toContain("child-process CPU and memory are not included");
    expect(formatMetrics(response, 9000)).toContain(
      "GET /api/health: 9 requests, 2 errors, p95 up to 8.0ms (bucket upper bound)",
    );
    expect(formatMetrics({ ...response, samples: [], requests: [] }, 9000)).toContain(
      "No samples yet\nRequests:\n  No requests yet",
    );
  });

  it("fetches the metrics route and prints full JSON on demand", async () => {
    const { executeMetrics } = await import("./metrics");
    const out = vi.fn();
    const fetch = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    // The client discovers the running instance from a lock and token; stub only that boundary.
    const client = await import("./client");
    const server = vi
      .spyOn(client, "discoverServer")
      .mockResolvedValue({ url: "http://localhost:4317", token: "secret" });
    const env = { home: "/tmp/tau", stdout: out, fetch, now: () => 9000 } as unknown as Parameters<
      typeof executeMetrics
    >[1];
    try {
      await executeMetrics(["--json"], env);
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:4317/api/metrics",
        expect.objectContaining({ method: "GET" }),
      );
      expect(JSON.parse(out.mock.calls[0]?.[0] as string)).toEqual(response);
    } finally {
      server.mockRestore();
    }
  });
});
