import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { MetricsResponseSchema } from "./metrics";
import { routes } from "./rest";

const response = {
  scope: "local",
  since: 1000,
  intervalMs: 5000,
  samples: [
    {
      at: 6000,
      intervalMs: 5000,
      cpuPercent: 12,
      rssBytes: 1024,
      heapUsedBytes: 512,
      externalBytes: 64,
      timerLagMs: 2,
    },
  ],
  requests: [{ method: "GET", route: "/api/health", count: 2, errors: 0, meanMs: 1, p95Ms: 2, maxMs: 3 }],
};

describe("local metrics route", () => {
  it("is owner-only and validates the frozen response", () => {
    expect(routes.getMetrics).toMatchObject({
      method: "GET",
      path: "/api/metrics",
      ownerOnly: true,
      response: MetricsResponseSchema,
    });
    expect(Value.Check(MetricsResponseSchema, response)).toBe(true);
    expect(Value.Check(MetricsResponseSchema, { ...response, scope: "global" })).toBe(false);
    expect(
      Value.Check(MetricsResponseSchema, {
        ...response,
        samples: [{ ...response.samples[0], timerLagMs: "2" }],
      }),
    ).toBe(false);
  });
});
