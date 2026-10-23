import { type Static, Type } from "typebox";

export const MetricsSampleSchema = Type.Object({
  at: Type.Number({ minimum: 0 }),
  intervalMs: Type.Number({ minimum: 0 }),
  cpuPercent: Type.Number({ minimum: 0 }),
  rssBytes: Type.Number({ minimum: 0 }),
  heapUsedBytes: Type.Number({ minimum: 0 }),
  externalBytes: Type.Number({ minimum: 0 }),
  timerLagMs: Type.Number({ minimum: 0 }),
});

export const MetricsRequestSchema = Type.Object({
  method: Type.String({ minLength: 1, maxLength: 8 }),
  route: Type.String({ minLength: 1, maxLength: 128 }),
  count: Type.Integer({ minimum: 0 }),
  errors: Type.Integer({ minimum: 0 }),
  meanMs: Type.Number({ minimum: 0 }),
  /** Upper bound of the latency histogram bucket containing the 95th-percentile request. */
  p95Ms: Type.Number({ minimum: 0 }),
  maxMs: Type.Number({ minimum: 0 }),
});

export const MetricsResponseSchema = Type.Object({
  scope: Type.Literal("local"),
  since: Type.Number({ minimum: 0 }),
  intervalMs: Type.Number({ minimum: 1 }),
  samples: Type.Array(MetricsSampleSchema, { maxItems: 360 }),
  requests: Type.Array(MetricsRequestSchema, { maxItems: 128 }),
});

export type MetricsResponse = Static<typeof MetricsResponseSchema>;
