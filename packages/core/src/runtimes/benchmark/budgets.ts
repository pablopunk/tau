import type { CellResult } from "./cell";
import type { Budget } from "./config";

export type BudgetStatus = "PASS" | "FAIL" | "NOT-EVALUATED";

export interface BudgetVerdict {
  readonly id: string;
  readonly description: string;
  readonly status: BudgetStatus;
  readonly reason: string;
  readonly limit: number | null;
  readonly measured: number | null;
}

const verdict = (
  budget: Budget,
  status: BudgetStatus,
  reason: string,
  limit: number | null = null,
  measured: number | null = null,
): BudgetVerdict => ({ id: budget.id, description: budget.description, status, reason, limit, measured });

const cellsOf = (results: readonly CellResult[], executor: string): CellResult[] =>
  results.filter((cell) => cell.executor === executor);

const unsupportedReason = (cells: readonly CellResult[]): string | undefined =>
  cells.find((cell) => cell.status === "UNSUPPORTED")?.reasons[0];

function stageVerdict(budget: Extract<Budget, { kind: "stage-percentile" }>, results: readonly CellResult[]) {
  const cell = results.find(
    (candidate) => candidate.executor === budget.executor && candidate.concurrency === budget.concurrency,
  );
  const label = `${budget.executor} x${budget.concurrency} ${budget.stage} ${budget.percentile}`;
  if (!cell) return verdict(budget, "NOT-EVALUATED", `${label}: cell not run`, budget.maxMs);
  if (cell.status === "UNSUPPORTED")
    return verdict(budget, "NOT-EVALUATED", cell.reasons[0] ?? "unsupported", budget.maxMs);
  const missing = cell.missingStages[budget.stage] ?? 0;
  if (missing > 0)
    return verdict(budget, "FAIL", `${label}: stage missing in ${missing} sample(s)`, budget.maxMs);
  const summary = cell.stages[budget.stage];
  if (!summary)
    return verdict(
      budget,
      "NOT-EVALUATED",
      `${label}: stage not defined for ${budget.executor}`,
      budget.maxMs,
    );
  const measured = budget.percentile === "max" ? summary.max : summary[budget.percentile];
  if (measured === null) {
    const why = summary.count === 0 ? "no samples" : `insufficient-samples (${summary.count} < 20)`;
    return verdict(budget, "NOT-EVALUATED", `${label}: ${why}`, budget.maxMs);
  }
  const passed = measured <= budget.maxMs;
  return verdict(
    budget,
    passed ? "PASS" : "FAIL",
    `${label}: ${measured} ms vs target ${budget.maxMs} ms`,
    budget.maxMs,
    measured,
  );
}

function idleCpuVerdict(budget: Extract<Budget, { kind: "idle-cpu-delta" }>, results: readonly CellResult[]) {
  const cells = cellsOf(results, budget.executor);
  const deltas = cells.flatMap((cell) => (cell.idleCpu ? [cell.idleCpu.deltaPercentagePoints] : []));
  const limit = budget.maxPercentagePoints;
  if (deltas.length === 0) {
    const why = unsupportedReason(cells) ?? "idle CPU was not measured for this executor";
    return verdict(budget, "NOT-EVALUATED", why, limit);
  }
  const worst = Math.max(...deltas);
  return verdict(
    budget,
    worst <= limit ? "PASS" : "FAIL",
    `worst idle CPU delta ${worst} pp vs target ${limit} pp`,
    limit,
    worst,
  );
}

function leftoverVerdict(
  budget: Extract<Budget, { kind: "no-leftover-processes" }>,
  results: readonly CellResult[],
) {
  const cells = cellsOf(results, budget.executor);
  const reports = cells.flatMap((cell) => (cell.cleanup ? [cell.cleanup] : []));
  if (reports.length === 0) {
    return verdict(budget, "NOT-EVALUATED", unsupportedReason(cells) ?? "no cleanup census was taken", 0);
  }
  const leftover = reports.reduce(
    (sum, report) => sum + report.childrenAliveAfterRun + report.descendantsLeftover,
    0,
  );
  return verdict(
    budget,
    leftover === 0 ? "PASS" : "FAIL",
    `${leftover} leftover process(es) after the runs`,
    0,
    leftover,
  );
}

function noErrorsVerdict(budget: Extract<Budget, { kind: "no-errors" }>, results: readonly CellResult[]) {
  const cells = cellsOf(results, budget.executor);
  const ran = cells.filter((cell) => cell.status !== "UNSUPPORTED");
  if (ran.length === 0)
    return verdict(budget, "NOT-EVALUATED", unsupportedReason(cells) ?? "cell not run", 0);
  const errors = ran.reduce((sum, cell) => sum + cell.errors, 0);
  return verdict(budget, errors === 0 ? "PASS" : "FAIL", `${errors} failed sample(s)`, 0, errors);
}

function verdictOf(budget: Budget, results: readonly CellResult[]): BudgetVerdict {
  if (budget.kind === "stage-percentile") return stageVerdict(budget, results);
  if (budget.kind === "idle-cpu-delta") return idleCpuVerdict(budget, results);
  if (budget.kind === "no-leftover-processes") return leftoverVerdict(budget, results);
  return noErrorsVerdict(budget, results);
}

export const evaluateBudgets = (
  budgets: readonly Budget[],
  results: readonly CellResult[],
): BudgetVerdict[] => budgets.map((budget) => verdictOf(budget, results));
