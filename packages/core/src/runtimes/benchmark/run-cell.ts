import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Core } from "@tau/protocol";
import { type FakeAnthropicServer, startFakeAnthropicServer } from "../testing/fake-anthropic-server";
import { createOfflineWorld, FAKE_API_KEY, type OfflineWorld } from "../testing/offline-sandbox";
import {
  type CellMeasurement,
  type CleanupReport,
  type IdleCpu,
  mergeColdMeasurements,
  recordSample,
  type SampleRecord,
} from "./cell";
import type { BenchmarkConfig, FixtureRepoSpec } from "./config";
import {
  configureFauxDefaults,
  observeRunEnds,
  openBenchmarkCore,
  type RunEndObserver,
  watchFirstAssistant,
} from "./core-driver";
import { copyFixtureRepo, createFixtureRepo } from "./fixture-repo";
import { createNativeProbes, NATIVE_ANSWER, NATIVE_MODEL, type NativeProbes } from "./native-probe";
import { cpuPercentOver, descendantsOf, isAlive, resourceSnapshot } from "./process-census";
import type { ExecutorKind, Marks } from "./stages";

export interface CellRequest {
  readonly cell?: NonNullable<BenchmarkConfig["cells"]>[number];
  readonly executor: ExecutorKind;
  readonly concurrency: 1 | 4;
  readonly samples: number;
  readonly warmup: number;
  readonly sampleTimeoutMs: number;
  readonly idleCpuWindowMs: number;
  readonly fixtureRepo: FixtureRepoSpec;
}

interface Lane {
  readonly projectId: string;
}

interface Rig {
  readonly core: Core;
  readonly observer: RunEndObserver;
  readonly lanes: readonly Lane[];
  readonly probes: NativeProbes | undefined;
  readonly server: FakeAnthropicServer | undefined;
}

/** Whatever was created so far, so a failed setup still removes everything it made. */
interface Resources {
  root?: string;
  world?: OfflineWorld;
  server?: FakeAnthropicServer;
  core?: Core;
  observer?: RunEndObserver;
  probes?: NativeProbes;
  fenced?: boolean;
}

interface RunTally {
  verifiedRuns: number;
  unverifiedRuns: number;
}

const now = (): number => performance.now();

const roundsFor = (runs: number, concurrency: number): number => Math.ceil(runs / concurrency);

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function makeRepos(base: string, count: number, spec: FixtureRepoSpec): string[] {
  const paths = Array.from({ length: count }, (_, lane) => join(base, "repos", `lane-${lane}`));
  mkdirSync(join(base, "repos"), { recursive: true });
  const [first, ...rest] = paths as [string, ...string[]];
  createFixtureRepo(first, spec);
  for (const path of rest) copyFixtureRepo(first, path);
  return paths;
}

async function startScriptedServer(runs: number): Promise<FakeAnthropicServer> {
  const turn = { blocks: [{ type: "text", text: NATIVE_ANSWER }] } as const;
  return startFakeAnthropicServer({
    apiKey: FAKE_API_KEY,
    script: Array.from({ length: runs }, () => turn),
    model: NATIVE_MODEL,
  });
}

async function openRig(request: CellRequest, runs: number, resources: Resources): Promise<Rig> {
  const native = request.executor === "claude-code";
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-benchmark-")));
  resources.root = root;
  if (native) resources.world = createOfflineWorld("runtime benchmark");
  if (native) resources.server = await startScriptedServer(runs);
  if (resources.world && resources.server) {
    resources.probes = createNativeProbes(resources.world, resources.server.url, now);
  }
  const core = await openBenchmarkCore(join(root, "home"), request.executor, resources.probes?.query);
  resources.core = core;
  await configureFauxDefaults(core);
  const repos = makeRepos(resources.world?.root ?? root, request.concurrency, request.fixtureRepo);
  if (request.cell?.scenario === "failure") {
    for (const repo of repos) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(repo, ".gitattributes"), "*.txt filter=benign\n");
      execFileSync("git", ["add", ".gitattributes"], { cwd: repo });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=benchmark",
          "-c",
          "user.email=benchmark@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-qm",
          "local benign filter fixture",
        ],
        { cwd: repo },
      );
      for (const key of ["filter.benign.clean", "filter.benign.smudge"])
        execFileSync("git", ["config", key, "false"], { cwd: repo });
      execFileSync("git", ["config", "filter.benign.required", "true"], { cwd: repo });
    }
  }
  const projects = await Promise.all(
    repos.map((path) =>
      core.projects.add({ path: request.cell?.cwd === "nested" ? join(path, "dir-0") : path }),
    ),
  );
  const observer = observeRunEnds(core);
  resources.observer = observer;
  return {
    core,
    observer,
    lanes: projects.map((project) => ({ projectId: project.id })),
    probes: resources.probes,
    server: resources.server,
  };
}

async function runOnce(
  rig: Rig,
  request: CellRequest,
  lane: Lane,
  tag: string,
  tally: RunTally,
): Promise<{ marks: Marks; error?: string; seenAtAttach: boolean }> {
  const marks: Marks = {};
  const prompt = `benchmark ${tag}`;
  rig.probes?.watch(prompt, marks);
  let watching: ReturnType<typeof watchFirstAssistant> | undefined;
  try {
    marks.submit = now();
    const thread = await rig.core.conversations.start({
      projectId: lane.projectId,
      text: prompt,
      requestId: `request-${tag}`,
      workspace: request.cell?.workspace ?? "checkout",
      ...(request.executor === "claude-code" && { executor: "claude-code" as const }),
    });
    marks.receipt = now();
    if (request.cell?.waiting === "background") await new Promise<void>((yes) => setImmediate(yes));
    if (request.cell?.scenario === "cancel") {
      await rig.core.conversations.abort(thread.id);
      marks.failureCancel = now();
    }
    if (request.executor === "pi") watching = watchFirstAssistant(rig.core, thread.id, marks, now);
    const ended = await rig.observer.waitForEnd(lane.projectId, thread.id, request.sampleTimeoutMs);
    marks.terminal = now();
    const watch = await watching;
    await watch?.stop();
    const verified =
      ended.status === "idle" && request.cell?.scenario !== "cancel" && request.cell?.scenario !== "failure";
    tally[verified ? "verifiedRuns" : "unverifiedRuns"] += 1;
    return {
      marks,
      seenAtAttach: watch?.seenAtAttach() ?? false,
      ...(!verified && { error: `the run ended with status ${ended.status}` }),
    };
  } catch (error) {
    marks.failureCancel = now();
    await watching?.then((watch) => watch.stop()).catch(() => undefined);
    return { marks, seenAtAttach: false, error: describeError(error) };
  }
}

async function runRound(
  rig: Rig,
  request: CellRequest,
  phase: string,
  round: number,
  tally: RunTally,
): Promise<{ lane: number; result: Awaited<ReturnType<typeof runOnce>> }[]> {
  return Promise.all(
    rig.lanes
      .slice(
        0,
        Math.max(
          0,
          Math.min(
            request.concurrency,
            (phase === "warmup" ? request.warmup : request.samples) - round * request.concurrency,
          ),
        ),
      )
      .map(async (lane, index) => ({
        lane: index,
        result: await runOnce(rig, request, lane, `${phase}-${round * request.concurrency + index}`, tally),
      })),
  );
}

async function measureAll(rig: Rig, request: CellRequest, tally: RunTally): Promise<SampleRecord[]> {
  const samples: SampleRecord[] = [];
  for (let round = 0; round < roundsFor(request.warmup, request.concurrency); round += 1) {
    await runRound(rig, request, "warmup", round, tally);
  }
  for (let round = 0; round < roundsFor(request.samples, request.concurrency); round += 1) {
    for (const { lane, result } of await runRound(rig, request, "sample", round, tally)) {
      const index = round * request.concurrency + lane;
      if (index >= request.samples) continue;
      samples.push(
        recordSample(request.executor, index, result.marks, {
          ...(result.error !== undefined && { error: result.error }),
          firstTextSeenAtAttach: result.seenAtAttach,
        }),
      );
    }
  }
  return samples;
}

async function idleCpuAround(windowMs: number, run: () => Promise<void>): Promise<IdleCpu> {
  const baselinePercent = await cpuPercentOver(windowMs);
  await run();
  const afterPercent = await cpuPercentOver(windowMs);
  return {
    baselinePercent,
    afterPercent,
    deltaPercentagePoints: Math.round((afterPercent - baselinePercent) * 100) / 100,
  };
}

const killGroup = (pid: number): void => {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* already gone */
  }
};

async function cleanupReportOf(
  rig: Rig,
  runs: number,
  tally: RunTally,
  before: ReadonlySet<number>,
): Promise<CleanupReport> {
  const pids = rig.probes?.childPids ?? [];
  const after = await descendantsOf();
  const leftover = [...after].filter((pid) => !before.has(pid));
  const native = rig.probes !== undefined;
  return {
    childrenSpawned: pids.length,
    childrenAliveAfterRun: pids.filter(isAlive).length,
    descendantsLeftover: leftover.length,
    supervisorVerifiedRuns: native ? tally.verifiedRuns : null,
    unverifiedRuns: native ? runs - tally.verifiedRuns : null,
    serverViolations: rig.server?.violations.length ?? 0,
    apiRequests: rig.server?.messageRequests.length ?? null,
  };
}

async function disposeResources(resources: Resources): Promise<void> {
  resources.observer?.stop();
  await resources.core?.close().catch(() => {
    resources.fenced = true;
  });
  resources.probes?.childPids.forEach(killGroup);
  await resources.server?.close().catch(() => undefined);
  if (resources.fenced) return;
  if (resources.world) rmSync(resources.world.root, { recursive: true, force: true });
  if (resources.root) rmSync(resources.root, { recursive: true, force: true });
}

const measurementBase = (request: CellRequest) => ({
  selection: request.cell,
  executor: request.executor,
  concurrency: request.concurrency,
  samplesRequested: request.samples,
  warmup: request.cell?.cache === "cold" ? 0 : request.warmup,
});

export async function runCell(request: CellRequest): Promise<CellMeasurement> {
  if (request.cell?.cache === "cold" && request.warmup > 0) return runCell({ ...request, warmup: 0 });
  const base = measurementBase(request);
  const unsupported =
    request.executor === "claude-code"
      ? "BLOCKED: actual native benchmark requires a disposable guest; direct SDK probe is not product compatibility"
      : undefined;
  if (unsupported) return { ...base, samples: [], unsupported };
  const runs = request.warmup + request.samples;
  if (request.cell?.cache === "cold" && request.samples > request.concurrency) {
    const measurements: CellMeasurement[] = [];
    for (let offset = 0; offset < request.samples; offset += request.concurrency) {
      measurements.push(
        await runCell({
          ...request,
          samples: Math.min(request.concurrency, request.samples - offset),
          warmup: 0,
        }),
      );
    }
    return mergeColdMeasurements(base, measurements);
  }
  const resources: Resources = {};
  try {
    const before = await descendantsOf();
    const rig = await openRig(request, runs, resources);
    const governorSettings = (await rig.core.settings.get()).resources;
    const tally: RunTally = { verifiedRuns: 0, unverifiedRuns: 0 };
    let samples: SampleRecord[] = [];
    const idleCpu = await idleCpuAround(request.idleCpuWindowMs, async () => {
      samples = await measureAll(rig, request, tally);
    });
    const resourcesBeforeClose = await resourceSnapshot();
    await rig.core.close();
    resources.core = undefined;
    const cleanup = await cleanupReportOf(rig, runs, tally, before);
    resources.fenced = cleanup.childrenAliveAfterRun + cleanup.descendantsLeftover > 0;
    return {
      ...base,
      samples,
      cleanup,
      idleCpu,
      resources: [resourcesBeforeClose, await resourceSnapshot()],
      governorSettings,
    };
  } catch (error) {
    resources.fenced = true;
    return { ...base, samples: [], fatal: describeError(error) };
  } finally {
    await disposeResources(resources);
  }
}
