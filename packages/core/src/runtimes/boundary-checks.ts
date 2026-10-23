import type { SandboxSettings } from "@tau/protocol";
import type { ThreadClass } from "../processes/governor/governed";
import { type SandboxSupport, sandboxBackend } from "../processes/sandbox/wrap";
import { policyScopeOf } from "./native/launch-policy";

export type CheckStatus = "PASS" | "FAIL" | "UNSUPPORTED";

export type EnforcementPath = "sandbox-exec" | "bwrap" | "systemd-unit" | "none";

export const EXIT_PASSED = 0;
export const EXIT_FAILED = 1;
export const EXIT_UNSUPPORTED = 2;

export interface CheckOutcome {
  readonly status: CheckStatus;
  readonly reason: string;
  readonly details?: Record<string, unknown>;
}

export interface CheckDefinition {
  readonly name: string;
  /** A required check that is UNSUPPORTED makes `--require-supported` exit 2; an informational one never does. */
  readonly required: boolean;
  readonly run: () => Promise<CheckOutcome>;
}

export interface CheckResult extends CheckOutcome {
  readonly name: string;
  readonly required: boolean;
  readonly elapsedMs: number;
}

export const pass = (reason: string, details?: Record<string, unknown>): CheckOutcome => ({
  status: "PASS",
  reason,
  ...(details && { details }),
});

export const fail = (reason: string, details?: Record<string, unknown>): CheckOutcome => ({
  status: "FAIL",
  reason,
  ...(details && { details }),
});

export const unsupported = (reason: string, details?: Record<string, unknown>): CheckOutcome => ({
  status: "UNSUPPORTED",
  reason,
  ...(details && { details }),
});

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const BACKEND_TO_PATH = { seatbelt: "sandbox-exec", bwrap: "bwrap", systemd: "systemd-unit" } as const;

export function enforcementPathOf(support: SandboxSupport, preferBwrap = true): EnforcementPath {
  const backend = sandboxBackend(support, preferBwrap);
  return backend ? BACKEND_TO_PATH[backend] : "none";
}

function timeoutAfter(ms: number): { promise: Promise<never>; cancel: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

export async function runCheck(definition: CheckDefinition, timeoutMs: number): Promise<CheckResult> {
  const startedAt = Date.now();
  const timeout = timeoutAfter(timeoutMs);
  const finish = (outcome: CheckOutcome): CheckResult => ({
    name: definition.name,
    required: definition.required,
    ...outcome,
    elapsedMs: Date.now() - startedAt,
  });
  try {
    return finish(await Promise.race([definition.run(), timeout.promise]));
  } catch (error) {
    return finish(fail(`check threw: ${describeError(error)}`));
  } finally {
    timeout.cancel();
  }
}

const countOf = (results: readonly CheckResult[], status: CheckStatus): number =>
  results.filter((result) => result.status === status).length;

export const summarize = (results: readonly CheckResult[]) => ({
  pass: countOf(results, "PASS"),
  fail: countOf(results, "FAIL"),
  unsupported: countOf(results, "UNSUPPORTED"),
});

export const unsupportedReasons = (results: readonly CheckResult[]) =>
  results
    .filter((result) => result.status === "UNSUPPORTED")
    .map((result) => ({ check: result.name, required: result.required, reason: result.reason }));

/** A failed assertion always wins; UNSUPPORTED only matters for required checks and only under `--require-supported`. */
export function exitCodeOf(results: readonly CheckResult[], requireSupported: boolean): number {
  if (results.some((result) => result.status === "FAIL")) return EXIT_FAILED;
  const missingRequired = results.some((result) => result.required && result.status === "UNSUPPORTED");
  return missingRequired && requireSupported ? EXIT_UNSUPPORTED : EXIT_PASSED;
}

export type ScopeDecision = "sandbox" | "plain";

export type ScopeMatrixRow = Readonly<Record<ThreadClass | "unknown", ScopeDecision>>;

export function scopeMatrixRow(settings: SandboxSettings): ScopeMatrixRow {
  const decide = (scope: ThreadClass | "unknown"): ScopeDecision =>
    policyScopeOf(scope, settings) === null ? "plain" : "sandbox";
  return {
    main: decide("main"),
    worktree: decide("worktree"),
    subagent: decide("subagent"),
    unknown: decide("unknown"),
  };
}

export interface ProbeLine {
  readonly label: string;
  readonly ok: boolean;
  readonly code?: string;
}

export function parseProbeLines(stdout: string): ProbeLine[] {
  return stdout.split("\n").flatMap((line): ProbeLine[] => {
    try {
      const parsed = JSON.parse(line) as Partial<ProbeLine>;
      return typeof parsed.label === "string" && typeof parsed.ok === "boolean"
        ? [{ label: parsed.label, ok: parsed.ok, ...(parsed.code !== undefined && { code: parsed.code }) }]
        : [];
    } catch {
      return [];
    }
  });
}

export type WriteExpectation = "allowed" | "denied";

const DENIAL_CODES: ReadonlySet<string> = new Set(["EPERM", "EACCES", "EROFS"]);

export interface WriteVerdict {
  readonly label: string;
  readonly expected: WriteExpectation;
  readonly observed: string;
  readonly holds: boolean;
}

export function judgeWrite(
  label: string,
  expected: WriteExpectation,
  lines: readonly ProbeLine[],
): WriteVerdict {
  const line = lines.find((candidate) => candidate.label === label);
  if (!line) return { label, expected, observed: "no probe result", holds: false };
  if (line.ok) return { label, expected, observed: "written", holds: expected === "allowed" };
  const code = line.code ?? "unknown error";
  return {
    label,
    expected,
    observed: `denied (${code})`,
    holds: expected === "denied" && DENIAL_CODES.has(code),
  };
}

export const verdictFailures = (verdicts: readonly WriteVerdict[]): string[] =>
  verdicts
    .filter((verdict) => !verdict.holds)
    .map((verdict) => `${verdict.label}: expected ${verdict.expected}, observed ${verdict.observed}`);

export interface BoundaryLimitsInput {
  readonly hostPlatform: "macos" | "linux" | "other";
}

export function boundaryLimits({ hostPlatform }: BoundaryLimitsInput): string[] {
  return [
    ...(hostPlatform === "linux"
      ? []
      : ["Linux enforcement paths (bwrap, systemd unit) are not exercised on this host: UNSUPPORTED here."]),
    "Reads and network are not confined by this sandbox: only writes are asserted.",
    "Hooks and plugins inside the real SDK are not exercised: the confined child is a node probe, not the SDK.",
    "The real-home write probe creates one marker file in the real home and removes it if the sandbox failed to block it.",
    "The priority check is a capability report with no assertion: no priority logic is implemented.",
  ];
}

export interface ReportInput {
  readonly generatedAt: string;
  readonly platform: { readonly os: string; readonly arch: string; readonly node: string };
  readonly enforcementPath: EnforcementPath;
  readonly binaries: Readonly<Record<string, string | undefined>>;
  readonly requestedPolicy: Readonly<Record<string, unknown>>;
  readonly results: readonly CheckResult[];
  readonly limits: readonly string[];
  readonly requireSupported: boolean;
  readonly leftoverProcesses: readonly number[];
}

export function buildReport(input: ReportInput) {
  return {
    schema: "tau.runtime-boundary/1",
    generatedAt: input.generatedAt,
    platform: input.platform,
    enforcementPath: input.enforcementPath,
    binaries: input.binaries,
    requestedPolicy: input.requestedPolicy,
    requireSupported: input.requireSupported,
    checks: input.results,
    unsupported: unsupportedReasons(input.results),
    summary: summarize(input.results),
    leftoverProcesses: input.leftoverProcesses,
    limits: input.limits,
    exitCode: exitCodeOf(input.results, input.requireSupported),
  };
}

export type BoundaryReport = ReturnType<typeof buildReport>;

export function summaryTable(report: BoundaryReport): string {
  const width = Math.max(...report.checks.map((check) => check.name.length));
  return report.checks.map((check) => `${check.name.padEnd(width)}  ${check.status}`).join("\n");
}
