import { describe, expect, it } from "vitest";
import { recordSample } from "./cell";
import type { BenchmarkConfig } from "./config";
import { buildReport, LIMITS, REPORT_SCHEMA, renderSummary } from "./report";

const CONFIG: BenchmarkConfig = {
  deterministicOverheadOnly: true,
  fixtureRepo: { directories: 1, files: 1, bytesPerFile: 1 },
  executors: ["pi", "claude-code"],
  samples: 3,
  warmup: 0,
  concurrency: [1],
  sampleTimeoutMs: 1000,
  rawSampleLimit: 10,
  idleCpuWindowMs: 10,
  budgets: {
    label: "TARGETS",
    targets: [
      {
        id: "pi-receipt",
        description: "receipt",
        kind: "stage-percentile",
        executor: "pi",
        concurrency: 1,
        stage: "submitToReceipt",
        percentile: "p95",
        maxMs: 100,
      },
    ],
  },
};

const ENVIRONMENT = {
  platform: "darwin",
  arch: "arm64",
  osRelease: "1",
  nodeVersion: "v22",
  cpuModel: "m",
  cpuCount: 1,
  sdkVersion: "0.0.0",
  gitVersion: "git 2",
  configHash: "abc",
};

const sample = (index: number) =>
  recordSample("pi", index, { submit: 0, receipt: 10, firstText: 15, terminal: 16 });

const report = (samples = [sample(0), sample(1), sample(2)]) =>
  buildReport({
    config: CONFIG,
    configPath: "e2e/x.json",
    effective: { samples: 3, concurrency: [1] },
    environment: ENVIRONMENT,
    measurements: [
      { executor: "pi", concurrency: 1, samplesRequested: 3, warmup: 0, samples },
      {
        executor: "claude-code",
        concurrency: 1,
        samplesRequested: 3,
        warmup: 0,
        samples: [],
        unsupported: "native is UNSUPPORTED on linux",
      },
    ],
    now: new Date("2026-01-01T00:00:00Z"),
  });

describe("buildReport", () => {
  it("states the overhead-only scope, the stage definitions and every limit", () => {
    const built = report();

    expect(built).toMatchObject({ schema: REPORT_SCHEMA, deterministicOverheadOnly: true });
    expect(built.statement).toContain("overhead diagnostic");
    expect(Object.keys(built.stageDefinitions)).toEqual(["pi", "claude-code"]);
    expect(built.stageDefinitions["claude-code"]?.map((stage) => stage.name)).toEqual([
      "submitToReceipt",
      "preparation",
      "launchToFirstEvent",
      "firstAssistantText",
      "terminalOutcome",
      "total",
    ]);
    expect(built.limits).toBe(LIMITS);
    for (const phrase of [
      "No real provider latency",
      "native cells are blocked",
      "No browser metrics",
      "Native stage definitions describe intended boundaries only",
      "Resource snapshots cover the in-process Core",
      "child-process CPU is lifetime ps output",
      "not comparable across machines",
      "overhead only",
    ]) {
      expect(LIMITS.join("\n")).toContain(phrase);
    }
  });

  it("does not qualify an UNSUPPORTED required native cell", () => {
    const built = report();

    expect(built.verdict).toBe("FAIL");
    expect(built.results.map((cell) => cell.status)).toEqual(["PASS", "UNSUPPORTED"]);
    expect(built.budgets.verdicts[0]?.status).toBe("NOT-EVALUATED");
  });

  it("fails the run when a stage is missing", () => {
    const broken = recordSample("pi", 3, { submit: 0, receipt: 10, terminal: 16 });

    expect(report([sample(0), sample(1), broken]).verdict).toBe("FAIL");
  });

  it("renders a summary naming status, missing stages and the verdict", () => {
    const text = renderSummary(report());

    expect(text).toContain("pi x1  PASS");
    expect(text).toContain("insufficient-samples");
    expect(text).toContain("claude-code x1  UNSUPPORTED");
    expect(text).toContain("Verdict: FAIL");
  });
});

it("does not select numeric CPU or latency budgets before controlled agreement", () => {
  const built = buildReport({
    config: {
      ...CONFIG,
      budgets: {
        ...CONFIG.budgets,
        selection: "UNSELECTED",
        targets: [
          ...CONFIG.budgets.targets,
          {
            id: "idle",
            description: "proposed",
            kind: "idle-cpu-delta",
            executor: "pi",
            maxPercentagePoints: 2,
          },
        ],
      },
    },
    configPath: "unit",
    effective: { samples: 3, concurrency: [1] },
    environment: ENVIRONMENT,
    measurements: [
      {
        executor: "pi",
        concurrency: 1,
        samplesRequested: 3,
        warmup: 0,
        samples: [sample(0), sample(1), sample(2)],
        idleCpu: { baselinePercent: 0, afterPercent: 9, deltaPercentagePoints: 9 },
      },
    ],
    now: new Date("2026-01-01"),
  });
  expect(
    built.budgets.verdicts.every((v) => v.status === "NOT-EVALUATED" && v.reason.includes("UNSELECTED")),
  ).toBe(true);
  expect(built.budgets.verdicts[1]?.limit).toBe(2);
  expect(built.results[0]?.idleCpu?.deltaPercentagePoints).toBe(9);
});
