import { type BudgetVerdict, evaluateBudgets } from "./budgets";
import { buildCellResult, type CellMeasurement, type CellResult } from "./cell";
import type { BenchmarkConfig } from "./config";
import { STAGES, stageNamesOf, TOTAL_STAGE } from "./stages";

export const REPORT_SCHEMA = "tau.runtime-benchmark/1";

export const STATEMENT =
  "Offline deterministic overhead diagnostic: Pi uses the faux provider; native cells are blocked pending a disposable guest. No real provider latency or performance qualification.";

export const LIMITS: readonly string[] = [
  "No real provider latency: Pi uses the faux provider; native cells are blocked and not launched without an authorized disposable guest.",
  "No browser metrics: the core is driven in process through conversations.start, watch and list, not through HTTP, WebSocket or the web app.",
  "Native stage definitions describe intended boundaries only; this host run records no native timing, sandbox spawn, SDK message or supervisor-cleanup evidence.",
  "Resource snapshots cover the in-process Core and benchmark harness plus observed descendant RSS and lifetime CPU; they are not total machine or browser readings.",
  "Numbers are not comparable across machines or across load levels; compare only runs of one machine.",
  "Native vs Pi comparison covers overhead only: the stage boundaries differ, so only submitToReceipt and total are comparable.",
  "Terminal and Pi first-text marks are observed through conversations.list (on change events or a 25 ms poll) and watch frames, so they include that observation latency.",
  "The recorded idle CPU delta covers this process over bounded windows; child-process CPU is lifetime ps output, not interval accounting.",
];

export interface EnvironmentFingerprint {
  readonly sourceTreeSha256?: string;
  readonly platform: string;
  readonly arch: string;
  readonly osRelease: string;
  readonly nodeVersion: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly sdkVersion: string;
  readonly gitVersion: string;
  readonly configHash: string;
}

export interface BenchmarkReport {
  readonly schema: typeof REPORT_SCHEMA;
  readonly generatedAt: string;
  readonly deterministicOverheadOnly: true;
  readonly statement: string;
  readonly environment: EnvironmentFingerprint;
  readonly config: BenchmarkConfig & { readonly path: string };
  readonly effective: { readonly samples: number; readonly concurrency: readonly number[] };
  readonly stageDefinitions: Readonly<
    Record<string, readonly { name: string; from: string; to: string; description: string }[]>
  >;
  readonly results: readonly CellResult[];
  readonly budgets: { readonly label: string; readonly verdicts: readonly BudgetVerdict[] };
  readonly limits: readonly string[];
  readonly verdict: "PASS" | "FAIL";
  readonly qualification: "UNSELECTED";
  readonly coverage: {
    readonly selectedCells: number;
    readonly measuredSamples: number;
    readonly cartesianCoverageClaimed: false;
  };
  readonly missingProductStages: readonly string[];
}

export interface ReportInput {
  readonly config: BenchmarkConfig;
  readonly configPath: string;
  readonly effective: { readonly samples: number; readonly concurrency: readonly number[] };
  readonly environment: EnvironmentFingerprint;
  readonly measurements: readonly CellMeasurement[];
  readonly now: Date;
}

const totalDefinition = {
  name: TOTAL_STAGE,
  from: "submit",
  to: "terminal",
  description: "conversations.start called until the benchmark observes the run ended",
};

const stageDefinitions = (): BenchmarkReport["stageDefinitions"] => ({
  pi: [...STAGES.pi, totalDefinition],
  "claude-code": [...STAGES["claude-code"], totalDefinition],
});

export function overallVerdict(
  results: readonly CellResult[],
  verdicts: readonly BudgetVerdict[],
): "PASS" | "FAIL" {
  const failedCell = results.length === 0 || results.some((cell) => cell.status !== "PASS");
  const failedBudget = verdicts.some((entry) => entry.status === "FAIL");
  return failedCell || failedBudget ? "FAIL" : "PASS";
}

export function buildReport(input: ReportInput): BenchmarkReport {
  const results = input.measurements.map((measurement) =>
    buildCellResult(measurement, input.config.rawSampleLimit),
  );
  const verdicts = evaluateBudgets(input.config.budgets.targets, results).map((v, index) =>
    input.config.budgets.selection === "UNSELECTED" &&
    ["stage-percentile", "idle-cpu-delta"].includes(input.config.budgets.targets[index]?.kind ?? "")
      ? {
          ...v,
          status: "NOT-EVALUATED" as const,
          reason: "UNSELECTED pending controlled baseline/operator agreement",
        }
      : v,
  );
  return {
    schema: REPORT_SCHEMA,
    generatedAt: input.now.toISOString(),
    deterministicOverheadOnly: true,
    statement: STATEMENT,
    environment: input.environment,
    config: { ...input.config, path: input.configPath },
    effective: input.effective,
    stageDefinitions: stageDefinitions(),
    results,
    budgets: { label: input.config.budgets.label, verdicts },
    limits: LIMITS,
    verdict: overallVerdict(results, verdicts),
    qualification: "UNSELECTED",
    coverage: {
      selectedCells: results.length,
      measuredSamples: results.reduce((sum, cell) => sum + cell.samplesMeasured, 0),
      cartesianCoverageClaimed: false,
    },
    missingProductStages: [
      "request-arrival",
      "workspace-ready",
      "before-input-snapshot",
      "browser-render",
      "background-workload-and-stalled-peer",
    ],
  };
}

const MS = (value: number | null): string => (value === null ? "-" : value.toFixed(1));

function stageRow(cell: CellResult, stage: string): string {
  const summary = cell.stages[stage];
  const missing = cell.missingStages[stage] ?? 0;
  if (!summary) return "";
  const spread =
    summary.percentileStatus === "reported"
      ? `p50 ${MS(summary.p50)}  p95 ${MS(summary.p95)}  max ${MS(summary.max)}`
      : `insufficient-samples  min ${MS(summary.min)}  med ${MS(summary.median)}  max ${MS(summary.max)}`;
  return `    ${stage.padEnd(20)} n=${String(summary.count).padEnd(3)} ${spread}  missing=${missing}`;
}

function cellLines(cell: CellResult): string[] {
  const head = `${cell.executor} x${cell.concurrency}  ${cell.status}  ok=${cell.samplesOk}/${cell.samplesMeasured}  errors=${cell.errors}`;
  if (cell.status === "UNSUPPORTED") return [head, `    ${cell.reasons.join("; ")}`];
  const rows = stageNamesOf(cell.executor).map((stage) => stageRow(cell, stage));
  const cleanup = cell.cleanup
    ? [
        `    cleanup: spawned=${cell.cleanup.childrenSpawned} aliveAfter=${cell.cleanup.childrenAliveAfterRun} leftover=${cell.cleanup.descendantsLeftover} verified=${cell.cleanup.supervisorVerifiedRuns ?? "n/a"}`,
      ]
    : [];
  const idle = cell.idleCpu
    ? [`    idle CPU delta: ${cell.idleCpu.deltaPercentagePoints.toFixed(2)} pp`]
    : [];
  const reasons = cell.status === "FAIL" ? cell.reasons.map((reason) => `    FAIL: ${reason}`) : [];
  return [head, ...rows, ...cleanup, ...idle, ...reasons];
}

export function renderSummary(report: BenchmarkReport): string {
  const budgetLines = report.budgets.verdicts.map(
    (entry) => `  ${entry.status.padEnd(13)} ${entry.id}: ${entry.reason}`,
  );
  return [
    `Runtime benchmark (${report.statement})`,
    ...report.results.flatMap(cellLines),
    `Budgets (${report.budgets.label}):`,
    ...budgetLines,
    `Verdict: ${report.verdict}`,
  ].join("\n");
}
