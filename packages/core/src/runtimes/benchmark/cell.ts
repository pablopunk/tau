import type { Settings } from "@tau/protocol";
import type { BenchmarkConfig } from "./config";
import type { ResourceSnapshot } from "./process-census";
import { type ExecutorKind, isCompleteTimeline, type Marks, stageNamesOf, timelineOf } from "./stages";
import { type Summary, summarize } from "./stats";

export interface SampleRecord {
  readonly boundary?: {
    readonly observation: "failure-or-abort-returned";
    readonly durationMs: number;
    readonly verifiedCancellation: false;
  };
  readonly index: number;
  readonly ok: boolean;
  readonly durationsMs: Readonly<Record<string, number>>;
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
  readonly error?: string;
  /** The first assistant text was already in the first watch frame, so its stage is an upper bound. */
  readonly firstTextSeenAtAttach?: boolean;
}

export interface CleanupReport {
  readonly childrenSpawned: number;
  readonly childrenAliveAfterRun: number;
  readonly descendantsLeftover: number;
  /** Runs whose terminal outcome the supervisor settled as verified-dead (`idle`); null when no child is supervised. */
  readonly supervisorVerifiedRuns: number | null;
  readonly unverifiedRuns: number | null;
  readonly serverViolations: number;
  readonly apiRequests: number | null;
}

export interface IdleCpu {
  readonly baselinePercent: number;
  readonly afterPercent: number;
  readonly deltaPercentagePoints: number;
}

export interface CellMeasurement {
  readonly governorSettings?: Settings["resources"];
  readonly resources?: readonly ResourceSnapshot[];
  readonly selection?: NonNullable<BenchmarkConfig["cells"]>[number];
  readonly executor: ExecutorKind;
  readonly concurrency: 1 | 4;
  readonly samplesRequested: number;
  readonly warmup: number;
  readonly samples: readonly SampleRecord[];
  readonly cleanup?: CleanupReport;
  readonly idleCpu?: IdleCpu;
  readonly unsupported?: string;
  readonly fatal?: string;
}

export type CellStatus = "PASS" | "FAIL" | "UNSUPPORTED";

export interface CellResult {
  readonly governorSettings?: Settings["resources"];
  readonly resources?: readonly ResourceSnapshot[];
  readonly selection?: NonNullable<BenchmarkConfig["cells"]>[number];
  readonly executor: ExecutorKind;
  readonly concurrency: 1 | 4;
  readonly status: CellStatus;
  readonly reasons: readonly string[];
  readonly samplesRequested: number;
  readonly warmup: number;
  readonly samplesMeasured: number;
  readonly samplesOk: number;
  readonly errors: number;
  readonly errorMessages: readonly string[];
  readonly missingStages: Readonly<Record<string, number>>;
  readonly invalidStages: Readonly<Record<string, number>>;
  readonly firstTextSeenAtAttach: number;
  readonly stages: Readonly<Record<string, Summary>>;
  readonly cleanup: CleanupReport | null;
  readonly idleCpu: IdleCpu | null;
  readonly rawSamples: readonly SampleRecord[];
  readonly rawSamplesTruncated: boolean;
}

const MAX_ERROR_MESSAGES = 5;

export function recordSample(
  executor: ExecutorKind,
  index: number,
  marks: Marks,
  extras: { readonly error?: string; readonly firstTextSeenAtAttach?: boolean } = {},
): SampleRecord {
  const timeline = timelineOf(executor, marks);
  return {
    index,
    ...(marks.failureCancel !== undefined &&
      marks.submit !== undefined && {
        boundary: {
          observation: "failure-or-abort-returned" as const,
          durationMs: marks.failureCancel - marks.submit,
          verifiedCancellation: false as const,
        },
      }),
    ok: extras.error === undefined && isCompleteTimeline(timeline),
    durationsMs: timeline.durationsMs,
    missing: timeline.missing,
    invalid: timeline.invalid,
    ...(extras.error !== undefined && { error: extras.error }),
    ...(extras.firstTextSeenAtAttach && { firstTextSeenAtAttach: true }),
  };
}

const countByStage = (lists: readonly (readonly string[])[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const stage of lists.flat()) counts[stage] = (counts[stage] ?? 0) + 1;
  return counts;
};

const distinctMessages = (samples: readonly SampleRecord[]): string[] => [
  ...new Set(samples.flatMap((sample) => (sample.error === undefined ? [] : [sample.error]))),
];

function stageSummaries(executor: ExecutorKind, ok: readonly SampleRecord[]): Record<string, Summary> {
  return Object.fromEntries(
    stageNamesOf(executor).map((stage) => [
      stage,
      summarize(
        ok.flatMap((sample) => (sample.durationsMs[stage] === undefined ? [] : [sample.durationsMs[stage]])),
      ),
    ]),
  );
}

const describeCounts = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .map(([stage, count]) => `${stage} x${count}`)
    .join(", ");

function failureReasons(
  measurement: CellMeasurement,
  facts: {
    errors: number;
    missing: Record<string, number>;
    invalid: Record<string, number>;
    messages: string[];
  },
): string[] {
  const reasons: string[] = [];
  if (measurement.fatal) reasons.push(`cell could not run: ${measurement.fatal}`);
  if (measurement.samples.length !== measurement.samplesRequested) reasons.push("sample count mismatch");
  if (measurement.samples.length === 0 && !measurement.fatal) reasons.push("no samples were measured");
  if (Object.keys(facts.missing).length > 0) reasons.push(`missing stages: ${describeCounts(facts.missing)}`);
  if (Object.keys(facts.invalid).length > 0)
    reasons.push(`out-of-order stages: ${describeCounts(facts.invalid)}`);
  if (facts.errors > 0) reasons.push(`${facts.errors} sample(s) failed: ${facts.messages.join(" | ")}`);
  const { cleanup } = measurement;
  if (cleanup && cleanup.childrenAliveAfterRun + cleanup.descendantsLeftover > 0) {
    reasons.push(
      `leftover processes: ${cleanup.childrenAliveAfterRun} owned child(ren) alive, ${cleanup.descendantsLeftover} new descendant(s)`,
    );
  }
  if (cleanup && (cleanup.unverifiedRuns ?? 0) > 0) {
    reasons.push(`${cleanup.unverifiedRuns} run(s) without supervisor-verified cleanup`);
  }
  if (cleanup && cleanup.serverViolations > 0) {
    reasons.push(`${cleanup.serverViolations} fake API violation(s)`);
  }
  return reasons;
}

export function buildCellResult(measurement: CellMeasurement, rawSampleLimit: number): CellResult {
  const { executor, samples } = measurement;
  const ok = samples.filter((sample) => sample.ok);
  const failed = samples.filter((sample) => !sample.ok);
  const missing = countByStage(samples.map((sample) => sample.missing));
  const invalid = countByStage(samples.map((sample) => sample.invalid));
  const messages = distinctMessages(failed).slice(0, MAX_ERROR_MESSAGES);
  const unsupported = measurement.unsupported;
  const reasons = unsupported
    ? [unsupported]
    : failureReasons(measurement, { errors: failed.length, missing, invalid, messages });
  return {
    executor,
    selection: measurement.selection,
    resources: measurement.resources,
    governorSettings: measurement.governorSettings,
    concurrency: measurement.concurrency,
    status: unsupported ? "UNSUPPORTED" : reasons.length > 0 ? "FAIL" : "PASS",
    reasons,
    samplesRequested: measurement.samplesRequested,
    warmup: measurement.warmup,
    samplesMeasured: samples.length,
    samplesOk: ok.length,
    errors: failed.length,
    errorMessages: messages,
    missingStages: missing,
    invalidStages: invalid,
    firstTextSeenAtAttach: samples.filter((sample) => sample.firstTextSeenAtAttach).length,
    stages: stageSummaries(executor, ok),
    cleanup: measurement.cleanup ?? null,
    idleCpu: measurement.idleCpu ?? null,
    rawSamples: samples.slice(0, rawSampleLimit),
    rawSamplesTruncated: samples.length > rawSampleLimit,
  };
}

export function mergeColdMeasurements(
  base: Omit<CellMeasurement, "samples">,
  rounds: readonly CellMeasurement[],
): CellMeasurement {
  const cleanups = rounds.flatMap((round) => (round.cleanup ? [round.cleanup] : []));
  const sum = (
    key: "childrenSpawned" | "childrenAliveAfterRun" | "descendantsLeftover" | "serverViolations",
  ) => cleanups.reduce((total, cleanup) => total + cleanup[key], 0);
  const idle = rounds.flatMap((round) => (round.idleCpu ? [round.idleCpu] : []));
  const settings = rounds.map((round) => JSON.stringify(round.governorSettings));
  return {
    ...base,
    samples: rounds.flatMap((round) => round.samples).map((sample, index) => ({ ...sample, index })),
    resources: rounds.flatMap((round) => round.resources ?? []),
    governorSettings: rounds[0]?.governorSettings,
    ...((rounds.some((round) => round.fatal) ||
      cleanups.length !== rounds.length ||
      new Set(settings).size > 1) && { fatal: "cold_round_failed_or_configuration_unmatched" }),
    cleanup: {
      childrenSpawned: sum("childrenSpawned"),
      childrenAliveAfterRun: sum("childrenAliveAfterRun"),
      descendantsLeftover: sum("descendantsLeftover"),
      serverViolations: sum("serverViolations"),
      supervisorVerifiedRuns: null,
      unverifiedRuns: null,
      apiRequests: null,
    },
    // The complete worst window is retained, not maxima assembled from unrelated windows.
    idleCpu: idle.sort((a, b) => b.deltaPercentagePoints - a.deltaPercentagePoints)[0],
  };
}
