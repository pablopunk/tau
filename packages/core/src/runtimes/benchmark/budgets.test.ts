import { describe, expect, it } from "vitest";
import { evaluateBudgets } from "./budgets";
import { buildCellResult, type CellMeasurement, type CleanupReport, recordSample } from "./cell";
import type { Budget } from "./config";
import type { ExecutorKind } from "./stages";

const CLEAN: CleanupReport = {
  childrenSpawned: 1,
  childrenAliveAfterRun: 0,
  descendantsLeftover: 0,
  supervisorVerifiedRuns: 1,
  unverifiedRuns: 0,
  serverViolations: 0,
  apiRequests: 1,
};

const receiptBudget = (executor: ExecutorKind, maxMs: number, concurrency: 1 | 4 = 1): Budget => ({
  id: `${executor}-receipt`,
  description: "receipt",
  kind: "stage-percentile",
  executor,
  concurrency,
  stage: "submitToReceipt",
  percentile: "p95",
  maxMs,
});

const cellWith = (receipts: readonly number[], over: Partial<CellMeasurement> = {}) => {
  const samples = receipts.map((receipt, index) =>
    recordSample("pi", index, { submit: 0, receipt, firstText: receipt + 1, terminal: receipt + 2 }),
  );
  return buildCellResult(
    {
      executor: "pi",
      concurrency: 1,
      samplesRequested: samples.length,
      warmup: 0,
      samples,
      cleanup: CLEAN,
      ...over,
    },
    100,
  );
};

const twenty = (value: number, last = value): number[] => [...Array.from({ length: 19 }, () => value), last];

describe("stage percentile budgets", () => {
  it("passes when the p95 meets the target", () => {
    const [verdict] = evaluateBudgets([receiptBudget("pi", 100)], [cellWith(twenty(50))]);

    expect(verdict).toMatchObject({ status: "PASS", limit: 100, measured: 50 });
  });

  it("fails when the p95 exceeds the target", () => {
    const [verdict] = evaluateBudgets([receiptBudget("pi", 100)], [cellWith(twenty(150))]);

    expect(verdict).toMatchObject({ status: "FAIL", measured: 150 });
  });

  it("is decided by the p95, not the max, so one outlier in twenty does not fail", () => {
    const [verdict] = evaluateBudgets([receiptBudget("pi", 100)], [cellWith(twenty(50, 900))]);

    expect(verdict?.status).toBe("PASS");
  });

  it("does not evaluate below 20 samples and says why", () => {
    const [verdict] = evaluateBudgets([receiptBudget("pi", 100)], [cellWith([10, 20, 30])]);

    expect(verdict).toMatchObject({ status: "NOT-EVALUATED", measured: null });
    expect(verdict?.reason).toContain("insufficient-samples (3 < 20)");
  });

  it("does not evaluate a cell that was not run", () => {
    const [verdict] = evaluateBudgets([receiptBudget("pi", 100, 4)], [cellWith(twenty(50))]);

    expect(verdict).toMatchObject({ status: "NOT-EVALUATED" });
    expect(verdict?.reason).toContain("cell not run");
  });

  it("does not evaluate an unsupported cell and carries its reason", () => {
    const unsupported = cellWith([], {
      executor: "claude-code",
      unsupported: "native is UNSUPPORTED on linux",
    });

    const [verdict] = evaluateBudgets([receiptBudget("claude-code", 100)], [unsupported]);

    expect(verdict).toMatchObject({ status: "NOT-EVALUATED", reason: "native is UNSUPPORTED on linux" });
  });

  it("fails when the budgeted stage is missing from any sample", () => {
    const broken = recordSample("pi", 20, { submit: 0, firstText: 5, terminal: 6 });
    const cell = cellWith(twenty(50), {
      samples: [
        ...twenty(50).map((r, i) =>
          recordSample("pi", i, { submit: 0, receipt: r, firstText: r + 1, terminal: r + 2 }),
        ),
        broken,
      ],
    });

    const [verdict] = evaluateBudgets([receiptBudget("pi", 100)], [cell]);

    expect(verdict).toMatchObject({ status: "FAIL" });
    expect(verdict?.reason).toContain("stage missing in 1 sample(s)");
  });

  it("evaluates a max budget from a single sample", () => {
    const budget: Budget = {
      ...(receiptBudget("pi", 100) as Extract<Budget, { kind: "stage-percentile" }>),
      percentile: "max",
    };

    expect(evaluateBudgets([budget], [cellWith([120])])[0]).toMatchObject({ status: "FAIL", measured: 120 });
  });

  it("does not evaluate a stage the executor does not have", () => {
    const budget: Budget = {
      ...(receiptBudget("pi", 100) as Extract<Budget, { kind: "stage-percentile" }>),
      stage: "preparation",
    };

    expect(evaluateBudgets([budget], [cellWith(twenty(50))])[0]?.reason).toContain(
      "stage not defined for pi",
    );
  });
});

describe("executor level budgets", () => {
  const idle: Budget = {
    id: "idle",
    description: "idle",
    kind: "idle-cpu-delta",
    executor: "pi",
    maxPercentagePoints: 2,
  };
  const leftover: Budget = { id: "left", description: "left", kind: "no-leftover-processes", executor: "pi" };
  const clean: Budget = { id: "clean", description: "clean", kind: "no-errors", executor: "pi" };

  it("compares the worst idle CPU delta with the target", () => {
    const passing = cellWith(twenty(5), {
      idleCpu: { baselinePercent: 0, afterPercent: 1, deltaPercentagePoints: 1 },
    });
    const failing = cellWith(twenty(5), {
      idleCpu: { baselinePercent: 0, afterPercent: 3, deltaPercentagePoints: 3 },
    });

    expect(evaluateBudgets([idle], [passing])[0]?.status).toBe("PASS");
    expect(evaluateBudgets([idle], [passing, failing])[0]).toMatchObject({ status: "FAIL", measured: 3 });
  });

  it("does not evaluate idle CPU that was never measured", () => {
    expect(evaluateBudgets([idle], [cellWith(twenty(5))])[0]).toMatchObject({ status: "NOT-EVALUATED" });
  });

  it("fails on any leftover process", () => {
    const dirty = cellWith(twenty(5), { cleanup: { ...CLEAN, descendantsLeftover: 1 } });

    expect(evaluateBudgets([leftover], [dirty])[0]).toMatchObject({ status: "FAIL", measured: 1 });
    expect(evaluateBudgets([leftover], [cellWith(twenty(5))])[0]?.status).toBe("PASS");
  });

  it("fails when any sample failed", () => {
    const failed = cellWith(twenty(5), { samples: [recordSample("pi", 0, {}, { error: "boom" })] });

    expect(evaluateBudgets([clean], [failed])[0]).toMatchObject({ status: "FAIL", measured: 1 });
  });
});
