import { describe, expect, it } from "vitest";
import {
  buildCellResult,
  type CellMeasurement,
  type CleanupReport,
  mergeColdMeasurements,
  recordSample,
} from "./cell";
import type { Marks } from "./stages";

const piMarks = (receipt: number): Marks => ({
  submit: 0,
  receipt,
  firstText: receipt + 5,
  terminal: receipt + 6,
});

const CLEAN: CleanupReport = {
  childrenSpawned: 0,
  childrenAliveAfterRun: 0,
  descendantsLeftover: 0,
  supervisorVerifiedRuns: null,
  unverifiedRuns: null,
  serverViolations: 0,
  apiRequests: null,
};

const piCell = (
  samples: ReturnType<typeof recordSample>[],
  over: Partial<CellMeasurement> = {},
): CellMeasurement => ({
  executor: "pi",
  concurrency: 1,
  samplesRequested: samples.length,
  warmup: 0,
  samples,
  cleanup: CLEAN,
  ...over,
});

const piSamples = (count: number) =>
  Array.from({ length: count }, (_, index) => recordSample("pi", index, piMarks(10 + index)));

describe("recordSample", () => {
  it("fails a sample whose stage was never recorded instead of passing it with a null", () => {
    const sample = recordSample("pi", 0, { submit: 0, receipt: 10, terminal: 20 });

    expect(sample.ok).toBe(false);
    expect(sample.missing).toEqual(["firstAssistantText", "terminalOutcome"]);
    expect(Object.values(sample.durationsMs).every((value) => typeof value === "number")).toBe(true);
  });

  it("fails a sample that carries an error even when every mark exists", () => {
    expect(recordSample("pi", 0, piMarks(10), { error: "boom" }).ok).toBe(false);
  });

  it("passes a complete error-free sample", () => {
    expect(recordSample("pi", 0, piMarks(10))).toMatchObject({ ok: true, missing: [], invalid: [] });
  });
});

describe("buildCellResult", () => {
  it("fails the whole cell when one sample is missing a stage", () => {
    const samples = [...piSamples(3), recordSample("pi", 3, { submit: 0, receipt: 10, firstText: 15 })];

    const result = buildCellResult(piCell(samples), 100);

    expect(result.status).toBe("FAIL");
    expect(result.missingStages).toEqual({ terminalOutcome: 1, total: 1 });
    expect(result.reasons.join()).toContain("missing stages: terminalOutcome x1, total x1");
    expect(result.stages.terminalOutcome?.count).toBe(3);
    expect(result.errors).toBe(1);
  });

  it("passes a clean cell and keeps min/median/max when samples are below the floor", () => {
    const result = buildCellResult(piCell(piSamples(3)), 100);

    expect(result.status).toBe("PASS");
    expect(result.stages.submitToReceipt).toMatchObject({
      count: 3,
      min: 10,
      median: 11,
      max: 12,
      p95: null,
      percentileStatus: "insufficient-samples",
    });
  });

  it("reports percentiles once 20 samples exist", () => {
    const result = buildCellResult(piCell(piSamples(20)), 100);

    expect(result.stages.submitToReceipt).toMatchObject({
      count: 20,
      p50: 19,
      p95: 28,
      percentileStatus: "reported",
    });
  });

  it("fails on leftover processes, unverified runs and fake API violations", () => {
    const dirty: CleanupReport = {
      ...CLEAN,
      childrenAliveAfterRun: 1,
      descendantsLeftover: 2,
      unverifiedRuns: 1,
      serverViolations: 3,
    };

    const result = buildCellResult(piCell(piSamples(2), { cleanup: dirty }), 100);

    expect(result.status).toBe("FAIL");
    expect(result.reasons.join("\n")).toContain(
      "leftover processes: 1 owned child(ren) alive, 2 new descendant(s)",
    );
    expect(result.reasons.join("\n")).toContain("without supervisor-verified cleanup");
    expect(result.reasons.join("\n")).toContain("3 fake API violation(s)");
  });

  it("fails a cell that measured nothing or could not run, and never calls it unsupported", () => {
    expect(buildCellResult(piCell([]), 100).status).toBe("FAIL");
    expect(buildCellResult(piCell([], { fatal: "no port" }), 100).reasons.join()).toContain(
      "cell could not run: no port",
    );
  });

  it("marks an unsupported platform as UNSUPPORTED without failing it", () => {
    const result = buildCellResult(
      piCell([], { executor: "claude-code", unsupported: "native is UNSUPPORTED on linux" }),
      100,
    );

    expect(result).toMatchObject({
      status: "UNSUPPORTED",
      reasons: ["native is UNSUPPORTED on linux"],
      samplesMeasured: 0,
    });
  });

  it("bounds the raw samples and says so", () => {
    const result = buildCellResult(piCell(piSamples(5)), 2);

    expect(result.rawSamples.map((sample) => sample.index)).toEqual([0, 1]);
    expect(result.rawSamplesTruncated).toBe(true);
    expect(result.samplesMeasured).toBe(5);
  });

  it("counts samples whose first text was only seen when the watch attached", () => {
    const attached = recordSample("pi", 1, piMarks(10), { firstTextSeenAtAttach: true });

    expect(buildCellResult(piCell([attached, ...piSamples(1)]), 100).firstTextSeenAtAttach).toBe(1);
  });
});

describe("cold process aggregation", () => {
  it("retains an earlier round's failed cleanup rather than only the final clean round", () => {
    const first = piCell(piSamples(1), { cleanup: { ...CLEAN, descendantsLeftover: 1 } });
    const last = piCell(piSamples(1));
    const merged = mergeColdMeasurements({ executor: "pi", concurrency: 1, samplesRequested: 2, warmup: 0 }, [
      first,
      last,
    ]);
    expect(merged.samples).toHaveLength(2);
    expect(merged.cleanup?.descendantsLeftover).toBe(1);
    expect(buildCellResult(merged, 100).status).toBe("FAIL");
  });
  it("does not hide missing rounds or cleanup evidence", () => {
    const merged = mergeColdMeasurements({ executor: "pi", concurrency: 1, samplesRequested: 2, warmup: 0 }, [
      piCell(piSamples(1), { cleanup: undefined }),
    ]);
    expect(merged.fatal).toContain("cold_round_failed");
    expect(buildCellResult(merged, 100).status).toBe("FAIL");
  });
});
