import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Assertion, candidateVerdict, executeArtifact } from "./product-artifact-support";

export const REQUIRED_ASSERTIONS = [
  "E.first-assistant-text",
  "E.follow-up",
  "E.restart",
  "E.real-preparation",
  "E.worktree",
  "E.nested-cwd",
  "E.cleanup",
  "E.frontend-provenance",
] as const;

interface ArtifactFile {
  path: string;
  sha256: string;
}
interface Artifact {
  directory: string;
  binary: ArtifactFile;
  version: string;
  platform: { os: "darwin" | "linux" | "windows"; arch: "arm64" | "x64" };
  web: { index: ArtifactFile; js: ArtifactFile[]; css: ArtifactFile[] };
  sdk: { name: "@anthropic-ai/claude-agent-sdk"; version: string };
}
export interface ArtifactManifest {
  version: 1;
  baseline: Artifact;
  candidate: Artifact;
}
export interface ScenarioManifest {
  version: 1;
  namespace: "E";
  seed: number;
  fixtures: unknown;
  cases: { id: string; fixtureId: string; requiredAssertions: string[] }[];
}

const invalid = (): never => {
  throw new Error("invalid_manifest");
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, keys: string[]): void => {
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) invalid();
};
const string = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) return invalid();
  return value;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) return invalid();
  return value;
};
const unique = (values: string[]): void => {
  if (new Set(values).size !== values.length) invalid();
};
const EXACT_SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const version = (value: unknown): string => {
  const text = string(value);
  if (EXACT_SEMVER.exec(text)?.[0] !== text) invalid();
  return text;
};

function artifactFile(value: unknown): ArtifactFile {
  const file = object(value);
  exact(file, ["path", "sha256"]);
  const path = string(file.path);
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes(":")
  )
    invalid();
  const sha256 = string(file.sha256);
  if (!/^[a-f0-9]{64}$/.test(sha256)) invalid();
  return { path, sha256 };
}

function artifact(value: unknown): Artifact {
  const item = object(value);
  exact(item, ["directory", "binary", "version", "platform", "web", "sdk"]);
  const directory = string(item.directory);
  if (!isAbsolute(directory)) invalid();
  const platform = object(item.platform);
  exact(platform, ["os", "arch"]);
  if (
    !["darwin", "linux", "windows"].includes(string(platform.os)) ||
    !["arm64", "x64"].includes(string(platform.arch))
  )
    invalid();
  const web = object(item.web);
  exact(web, ["index", "js", "css"]);
  const js = list(web.js).map(artifactFile);
  const css = list(web.css).map(artifactFile);
  if (js.length === 0 || css.length === 0) invalid();
  const index = artifactFile(web.index);
  const binary = artifactFile(item.binary);
  unique([binary.path, index.path, ...js.map((file) => file.path), ...css.map((file) => file.path)]);
  const sdk = object(item.sdk);
  exact(sdk, ["name", "version"]);
  if (sdk.name !== "@anthropic-ai/claude-agent-sdk") invalid();
  return {
    directory,
    binary,
    version: version(item.version),
    platform: platform as Artifact["platform"],
    web: { index, js, css },
    sdk: { name: "@anthropic-ai/claude-agent-sdk", version: version(sdk.version) },
  };
}

export function parseArtifactManifest(value: unknown): ArtifactManifest {
  const item = object(value);
  exact(item, ["version", "baseline", "candidate"]);
  if (item.version !== 1) invalid();
  return { version: 1, baseline: artifact(item.baseline), candidate: artifact(item.candidate) };
}

export function parseScenarioManifest(value: unknown): ScenarioManifest {
  const item = object(value);
  exact(item, ["version", "namespace", "seed", "fixtures", "cases"]);
  if (item.version !== 1 || item.namespace !== "E" || !Number.isSafeInteger(item.seed)) invalid();
  object(item.fixtures);
  const cases = list(item.cases).map((value) => {
    const entry = object(value);
    exact(entry, ["id", "fixtureId", "requiredAssertions"]);
    const id = string(entry.id);
    const requiredAssertions = list(entry.requiredAssertions).map(string);
    if (
      !/^E\.[a-z0-9][a-z0-9.-]{0,95}$/.test(id) ||
      requiredAssertions.some((id) => !/^E\.[a-z0-9][a-z0-9.-]{0,95}$/.test(id))
    )
      invalid();
    const fixtureId = string(entry.fixtureId);
    if (!/^[a-z0-9][a-z0-9.-]{0,95}$/.test(fixtureId)) invalid();
    unique(requiredAssertions);
    return { id, fixtureId, requiredAssertions };
  });
  unique(cases.map((entry) => entry.id));
  unique(cases.flatMap((entry) => entry.requiredAssertions));
  return { version: 1, namespace: "E", seed: item.seed as number, fixtures: item.fixtures, cases };
}

export function parseArgs(argv: readonly string[]): { artifacts: string; scenarios: string; output: string } {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (
      !key ||
      !["--artifacts", "--scenarios", "--output"].includes(key) ||
      !value ||
      value.startsWith("--") ||
      flags.has(key)
    )
      throw new Error("invalid_invocation");
    flags.set(key, value);
  }
  const artifacts = flags.get("--artifacts");
  const scenarios = flags.get("--scenarios");
  const output = flags.get("--output");
  if (
    !artifacts ||
    !scenarios ||
    !output ||
    resolve(output) === resolve(artifacts) ||
    resolve(output) === resolve(scenarios)
  )
    throw new Error("invalid_invocation");
  return { artifacts, scenarios, output };
}

async function toolingFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [
    "scripts/verify-product-artifact.ts",
    "scripts/product-artifact-support.ts",
    "e2e/product-recovery.config.ts",
    "e2e/product-tests/product-recovery-artifact.spec.ts",
    "packages/web/src/lib/paths.ts",
    "pnpm-lock.yaml",
  ]) {
    hash.update(path).update(await readFile(resolve(import.meta.dirname, "..", path)));
  }
  return hash.digest("hex");
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch {
    console.error("invalid_invocation");
    return 64;
  }
  try {
    await lstat(args.output);
    console.error("report_not_written");
    return 2;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("report_not_written");
      return 2;
    }
  }
  const toolingSha256 = await toolingFingerprint();
  let artifactDescriptorSha256: string | null = null;
  let manifest: ArtifactManifest | undefined;
  let scenarios: ScenarioManifest | undefined;
  let scenarioSha256: string | null = null;
  const reasons: string[] = [];
  try {
    const text = await readFile(args.artifacts, "utf8");
    manifest = parseArtifactManifest(JSON.parse(text));
    artifactDescriptorSha256 = createHash("sha256").update(text).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") reasons.push("missing_artifact_descriptor");
    else {
      console.error("invalid_artifact_descriptor");
      return 64;
    }
  }
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
  const required = [...new Set([...REQUIRED_ASSERTIONS, "E.native-actual-sdk", ...requested])];
  if (!scenarios?.cases.length) reasons.push("no_scenarios");
  if ([...REQUIRED_ASSERTIONS, "E.native-actual-sdk"].some((id) => !requested.includes(id)))
    reasons.push("missing_required_cases");
  const executions =
    manifest && scenarios?.cases.length
      ? await (async () => {
          const runs = [];
          for (const role of ["baseline", "candidate"] as const)
            runs.push({ role, ...(await executeArtifact(manifest[role], scenarios)) });
          return runs;
        })()
      : [];
  const candidate = executions.find((run) => run.role === "candidate");
  const assertions: Assertion[] = required.map(
    (id) =>
      (requested.includes(id) ? candidate?.assertions.find((a) => a.id === id) : undefined) ?? {
        id,
        status: "BLOCKED",
        reason: "missing_required_execution",
      },
  );
  const toolingUnchanged = toolingSha256 === (await toolingFingerprint());
  if (!toolingUnchanged) {
    reasons.push("tooling_changed_during_execution");
    for (const assertion of assertions)
      if (assertion.status === "PASS") {
        assertion.status = "BLOCKED";
        assertion.reason = "tooling_changed_during_execution";
      }
  }
  const assertionVerdict = candidateVerdict(assertions);
  const baselineBlocked =
    manifest !== undefined && !executions.find((run) => run.role === "baseline")?.provenanceVerified;
  if (baselineBlocked) reasons.push("baseline_provenance_unverified");
  const verdict = assertionVerdict === "PASS" && baselineBlocked ? "BLOCKED" : assertionVerdict;
  const provenance = manifest
    ? ["baseline", "candidate"].map((role) => {
        const item = manifest[role as "baseline" | "candidate"];
        const execution = executions.find((run) => run.role === role);
        return {
          role,
          version: item.version,
          platform: item.platform,
          binarySha256: item.binary.sha256,
          webSha256: [item.web.index, ...item.web.js, ...item.web.css].map((file) => file.sha256),
          sdk: item.sdk,
          sdkTreeSha256: execution?.sdkTreeSha256 ?? null,
          sdkTreeScope:
            "upstream SDK package payload and native package; generated nested node_modules wrappers excluded; not transitive-dependency certification",
          verified: execution?.provenanceVerified ?? false,
        };
      })
    : [];
  const passed = assertions.filter((a) => a.status === "PASS").length;
  const failed = assertions.filter((a) => a.status === "FAIL").length;
  const blocked = assertions.filter((a) => a.status === "BLOCKED").length;
  const report = {
    version: 1,
    driver: "product-artifact",
    verdict,
    reasons,
    scenarioSha256,
    artifactDescriptorSha256,
    toolingSha256,
    toolingUnchanged,
    generatedAt: new Date().toISOString(),
    evidenceKind: candidate?.cases.length ? "compiled-artifact-execution" : "static",
    provenance,
    counts: { required: required.length, asserted: passed + failed, passed, failed, blocked },
    assertions,
    executions,
    stages: [],
    missingStages: [
      "request-arrival",
      "workspace-ready",
      "before-input-snapshot",
      "admission-sdk-launch",
      "failure-cancel",
      "first-assistant-text-duration",
      "browser-render-duration",
    ],
    resources: { server: null, ownedChildren: null, browserJs: null, wholeBrowser: null },
    persistedEffects: [],
    forbiddenEffects: [],
    cleanup: candidate?.cleanup ?? { verified: false },
    qualification:
      "NOT_QUALIFIED: phase-1 diagnostic; incident/company/platform/combined-lane proof outstanding",
    incident: { status: "BLOCKED", reason: "original_owner_incident_unreproduced" },
    comparison: {
      sameBinary: manifest ? manifest.baseline.binary.sha256 === manifest.candidate.binary.sha256 : null,
      releasedSourceVerification: "separate_public_release_checksum_evidence_required",
    },
    coverage: {
      selectedCases: scenarios?.cases.length ?? 0,
      executedCases: candidate?.cases.length ?? 0,
      cartesianCoverageClaimed: false,
    },
  };
  try {
    await mkdir(dirname(resolve(args.output)), { recursive: true });
    await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  } catch {
    console.error("report_not_written");
    return 2;
  }
  return verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
