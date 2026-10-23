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
    expect(built.statement).toContain("overhead only");
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
      "No browser metrics",
      "sandbox-exec",
      "not comparable across machines",
      "overhead only",
    ]) {
      expect(LIMITS.join("\n")).toContain(phrase);
    }
  });

  it("passes with budgets NOT-EVALUATED for few samples and an UNSUPPORTED native cell", () => {
    const built = report();

    expect(built.verdict).toBe("PASS");
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
    expect(text).toContain("Verdict: PASS");
  });
});
