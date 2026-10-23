import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_ASSERTIONS = [
  "B.durable-admission",
  "B.pre-snapshot",
  "B.snapshot-pre-launch",
  "B.durable-launch",
  "B.mutating-tool-request",
  "B.pending-approval",
  "B.persisted-result-pre-finalization",
  "B.completion-pre-parent-result",
  "B.denied-edit-absent",
  "B.recovery-no-blind-retry",
  "B.owned-process-cleanup",
] as const;

export interface ScenarioManifest {
  version: 1;
  namespace: "B";
  seed: number;
  fixtures: unknown;
  cases: { id: string; fixtureId: string; requiredAssertions: string[] }[];
}

const invalid = (): never => {
  throw new Error("invalid_scenario_manifest");
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, keys: string[]): void => {
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) invalid();
};
const id = (value: unknown): string => {
  if (typeof value !== "string" || !/^B\.[a-z0-9][a-z0-9.-]{0,95}$/.test(value)) return invalid();
  return value;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) return invalid();
  return value;
};
const unique = (values: string[]): void => {
  if (new Set(values).size !== values.length) invalid();
};

export function parseScenarioManifest(value: unknown): ScenarioManifest {
  const item = object(value);
  exact(item, ["version", "namespace", "seed", "fixtures", "cases"]);
  if (item.version !== 1 || item.namespace !== "B" || !Number.isSafeInteger(item.seed)) invalid();
  object(item.fixtures);
  const cases = list(item.cases).map((value) => {
    const entry = object(value);
    exact(entry, ["id", "fixtureId", "requiredAssertions"]);
    if (typeof entry.fixtureId !== "string" || !/^[a-z0-9][a-z0-9.-]{0,95}$/.test(entry.fixtureId)) invalid();
    const requiredAssertions = list(entry.requiredAssertions).map(id);
    unique(requiredAssertions);
    return { id: id(entry.id), fixtureId: entry.fixtureId as string, requiredAssertions };
  });
  unique(cases.map((entry) => entry.id));
  unique(cases.flatMap((entry) => entry.requiredAssertions));
  return { version: 1, namespace: "B", seed: item.seed as number, fixtures: item.fixtures, cases };
}

export function parseArgs(argv: readonly string[]): { scenarios: string; output: string } {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (
      !key ||
      !["--scenarios", "--output"].includes(key) ||
      !value ||
      value.startsWith("--") ||
      flags.has(key)
    )
      throw new Error("invalid_invocation");
    flags.set(key, value);
  }
  const scenarios = flags.get("--scenarios");
  const output = flags.get("--output");
  if (!scenarios || !output || resolve(output) === resolve(scenarios)) throw new Error("invalid_invocation");
  return { scenarios, output };
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch {
    console.error("invalid_invocation");
    return 64;
  }
  let scenarios: ScenarioManifest | undefined;
  let scenarioSha256: string | null = null;
  const reasons: string[] = [];
  try {
    const text = await readFile(args.scenarios, "utf8");
    scenarios = parseScenarioManifest(JSON.parse(text));
    scenarioSha256 = createHash("sha256").update(text).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") reasons.push("missing_scenario_manifest");
    else {
      console.error("invalid_scenario_manifest");
      return 64;
    }
  }
  const requested = scenarios?.cases.flatMap((entry) => entry.requiredAssertions) ?? [];
  const required = [...new Set([...REQUIRED_ASSERTIONS, ...requested])];
  if (!scenarios?.cases.length) reasons.push("no_scenarios");
  if (REQUIRED_ASSERTIONS.some((id) => !requested.includes(id))) reasons.push("missing_required_cases");
  reasons.push("native_product_integration_not_implemented");
  const report = {
    version: 1,
    driver: "native-product",
    verdict: "BLOCKED",
    reasons,
    scenarioSha256,
    evidenceKind: "static",
    sdk: { pinnedVersionVerified: false, productionControllerExecuted: false },
    counts: { required: required.length, asserted: 0, passed: 0, failed: 0, blocked: required.length },
    assertions: required.map((id) => ({
      id,
      status: "BLOCKED",
      reason: "native_product_integration_not_implemented",
    })),
    stages: [],
    missingStages: [
      "submit",
      "request-arrival",
      "workspace-ready",
      "before-input-snapshot",
      "admission-sdk-launch",
      "first-assistant-text",
      "browser-render",
      "failure-cancel",
    ],
    resources: { server: null, ownedChildren: null, browserJs: null, wholeBrowser: null },
    persistedEffects: [],
    forbiddenEffects: [],
    cleanup: { verified: false },
  };
  try {
    await mkdir(dirname(resolve(args.output)), { recursive: true });
    await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  } catch {
    console.error("report_not_written");
    return 2;
  }
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
