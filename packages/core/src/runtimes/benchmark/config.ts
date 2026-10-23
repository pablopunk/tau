import { createHash } from "node:crypto";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const ExecutorSchema = Type.Union([Type.Literal("pi"), Type.Literal("claude-code")]);
const ConcurrencySchema = Type.Union([Type.Literal(1), Type.Literal(4)]);
const Positive = Type.Integer({ minimum: 1 });

const StagePercentileBudgetSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    kind: Type.Literal("stage-percentile"),
    executor: ExecutorSchema,
    concurrency: ConcurrencySchema,
    stage: Type.String({ minLength: 1 }),
    percentile: Type.Union([Type.Literal("p50"), Type.Literal("p95"), Type.Literal("max")]),
    maxMs: Type.Number({ exclusiveMinimum: 0 }),
  },
  { additionalProperties: false },
);

const IdleCpuBudgetSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    kind: Type.Literal("idle-cpu-delta"),
    executor: ExecutorSchema,
    maxPercentagePoints: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const NoLeftoverBudgetSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    kind: Type.Literal("no-leftover-processes"),
    executor: ExecutorSchema,
  },
  { additionalProperties: false },
);

const NoErrorsBudgetSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    kind: Type.Literal("no-errors"),
    executor: ExecutorSchema,
  },
  { additionalProperties: false },
);

const BudgetSchema = Type.Union([
  StagePercentileBudgetSchema,
  IdleCpuBudgetSchema,
  NoLeftoverBudgetSchema,
  NoErrorsBudgetSchema,
]);

export const BenchmarkConfigSchema = Type.Object(
  {
    deterministicOverheadOnly: Type.Literal(true),
    fixtureRepo: Type.Object(
      { directories: Positive, files: Positive, bytesPerFile: Positive },
      { additionalProperties: false },
    ),
    executors: Type.Array(ExecutorSchema, { minItems: 1, uniqueItems: true }),
    samples: Positive,
    warmup: Type.Integer({ minimum: 0 }),
    concurrency: Type.Array(ConcurrencySchema, { minItems: 1, uniqueItems: true }),
    sampleTimeoutMs: Positive,
    rawSampleLimit: Positive,
    idleCpuWindowMs: Positive,
    budgets: Type.Object(
      { label: Type.String({ minLength: 1 }), targets: Type.Array(BudgetSchema) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type BenchmarkConfig = Static<typeof BenchmarkConfigSchema>;
export type Budget = BenchmarkConfig["budgets"]["targets"][number];
export type FixtureRepoSpec = BenchmarkConfig["fixtureRepo"];

const describeIssue = (issue: { instancePath: string; message: string }): string =>
  `${issue.instancePath || "/"}: ${issue.message}`;

function duplicateBudgetIds(budgets: readonly Budget[]): string[] {
  const seen = new Set<string>();
  return budgets.flatMap(({ id }) =>
    seen.size === seen.add(id).size ? [`budget id "${id}" is repeated`] : [],
  );
}

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid benchmark config:\n- ${problems.join("\n- ")}`);
  }
}

export function parseConfig(value: unknown): BenchmarkConfig {
  if (!Value.Check(BenchmarkConfigSchema, value)) {
    const problems = Value.Errors(BenchmarkConfigSchema, value).map(describeIssue);
    throw new ConfigError(problems.length > 0 ? problems : ["does not match the schema"]);
  }
  const duplicates = duplicateBudgetIds(value.budgets.targets);
  if (duplicates.length > 0) throw new ConfigError(duplicates);
  return value;
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, canonical(inner)]),
  );
};

/** Stable across key order and whitespace of the config file. */
export const configHash = (config: BenchmarkConfig): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(config)))
    .digest("hex");
