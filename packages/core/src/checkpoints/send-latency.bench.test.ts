import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import type { WorkspaceMode } from "@tau/protocol";
import { afterEach, describe, it } from "vitest";
import { createConversationForker } from "../harness/conversation-fork";
import { openConversationHarness, startRequest, waitUntilTrue } from "../test-support/conversation-harness";
import {
  answerCount,
  openFauxWorld,
  trackView,
  waitForAnswer,
  waitForAnswerAfter,
} from "../test-support/faux-core";
import { createCheckpointService } from "./checkpoint-service";

const run = promisify(execFile);
const REPOSITORY_SIZES = [200, 2_000, 20_000];
const RUNS = 5;
const SMALL_CONTENT = "x\n";

type BenchmarkRow = {
  readonly files: number;
  readonly operation: string;
  readonly samplesMs: number[];
  readonly medianMs: number;
  readonly maxMs: number;
};

const roundMs = (milliseconds: number) => Math.round(milliseconds * 100) / 100;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const center = sorted[middle];
  if (sorted.length % 2 === 1 || center === undefined) return roundMs(center ?? 0);
  return roundMs(((sorted[middle - 1] ?? 0) + center) / 2);
}

async function elapsed(action: () => Promise<unknown>): Promise<number> {
  const startedAt = performance.now();
  await action();
  return roundMs(performance.now() - startedAt);
}

function row(files: number, operation: string, samplesMs: number[]): BenchmarkRow {
  return {
    files,
    operation,
    samplesMs,
    medianMs: median(samplesMs),
    maxMs: roundMs(Math.max(...samplesMs)),
  };
}

const fileName = (index: number) => `tracked-${String(index).padStart(5, "0")}.txt`;

async function makeRepository(path: string, fileCount: number): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, ".gitignore"), "agent.sqlite*\n");
  for (let start = 0; start < fileCount; start += 512) {
    const end = Math.min(start + 512, fileCount);
    await Promise.all(
      Array.from({ length: end - start }, (_, offset) =>
        writeFile(join(path, fileName(start + offset)), SMALL_CONTENT),
      ),
    );
  }
  await run("git", ["init", "--quiet", path]);
  await run("git", ["-C", path, "config", "user.name", "Tau Benchmark"]);
  await run("git", ["-C", path, "config", "user.email", "tau-bench@example.test"]);
  await run("git", ["-C", path, "add", "--all"]);
  await run("git", ["-C", path, "commit", "--quiet", "-m", "benchmark fixture"]);
}

async function recordSnapshotSamples(root: string, repo: string, files: number): Promise<BenchmarkRow[]> {
  const harness = await openConversationHarness(repo, { tokensPerSecond: 10_000 });
  const close = () => harness.close();
  closeHarnesses.push(close);
  try {
    const forker = createConversationForker(harness.harness, harness.store);
    const checkpoints = createCheckpointService({
      home: join(root, "checkpoint-home"),
      conversations: harness.store,
      forker,
    });
    const { summary } = await harness.store.start(startRequest(harness, "benchmark setup", "snapshot-setup"));
    await waitUntilTrue(
      async () => (await harness.store.find(summary.id))?.status === "idle",
      "the snapshot benchmark thread to become idle",
    );

    const rows: BenchmarkRow[] = [];
    const unchanged: number[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      const requestId = `snapshot-unchanged-${index}`;
      unchanged.push(await elapsed(() => checkpoints.snapshotBefore(summary.id, requestId)));
      await checkpoints.snapshotAfter(summary.id, requestId);
    }
    rows.push(row(files, "snapshotBefore unchanged tree", unchanged));

    const changed: number[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      const content = `changed-${index}\n`;
      await Promise.all(
        Array.from({ length: 50 }, (_, fileIndex) => writeFile(join(repo, fileName(fileIndex)), content)),
      );
      const requestId = `snapshot-changed-${index}`;
      changed.push(await elapsed(() => checkpoints.snapshotBefore(summary.id, requestId)));
      await checkpoints.snapshotAfter(summary.id, requestId);
    }
    rows.push(row(files, "snapshotBefore with 50 changed files", changed));
    return rows;
  } finally {
    await close();
    closeHarnesses.splice(closeHarnesses.indexOf(close), 1);
  }
}

async function setUpCore(root: string, repo: string) {
  const world = await openFauxWorld(root);
  await world.core.providers.setApiKey("openrouter", "sk-test");
  const model = (await world.core.models.list()).find((item) => item.modelId === "faux-1");
  if (!model) throw new Error("The faux provider did not expose faux-1.");
  await world.core.settings.setDefaultModel({ provider: model.provider, modelId: model.modelId });
  const project = await world.core.projects.add({ path: repo });
  return { world, model, project };
}

async function waitForIdleRun(core: Awaited<ReturnType<typeof openFauxWorld>>["core"], id: string) {
  const tracker = await trackView(core, id);
  await waitForAnswer(tracker);
  await tracker.stop();
}

async function waitForAfterCheckpoint(
  core: Awaited<ReturnType<typeof openFauxWorld>>["core"],
  id: string,
  requestId: string,
): Promise<void> {
  await waitUntilTrue(
    async () =>
      (await core.conversations.checkpoints(id)).some(
        (checkpoint) => checkpoint.requestId === requestId && checkpoint.kind === "after",
      ),
    `the after checkpoint for ${requestId}`,
  );
}

async function recordConversationSamples(root: string, repo: string, files: number): Promise<BenchmarkRow[]> {
  const { world, model, project } = await setUpCore(root, repo);
  const close = () => world.core.close();
  closeHarnesses.push(close);
  try {
    const core = world.core;
    const initial = await core.conversations.start({
      projectId: project.id,
      text: "benchmark send setup",
      requestId: "send-setup",
      workspace: "checkout",
      model: { provider: model.provider, modelId: model.modelId },
      executor: "pi",
    });
    const tracker = await trackView(core, initial.id);
    await waitForAnswer(tracker);
    await waitForAfterCheckpoint(core, initial.id, "send-setup");

    const sends: number[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      const before = answerCount(tracker);
      sends.push(
        await elapsed(() =>
          core.conversations.send(initial.id, {
            text: "benchmark send receipt",
            requestId: `send-${index}`,
          }),
        ),
      );
      await waitForAnswerAfter(tracker, before);
      await waitForAfterCheckpoint(core, initial.id, `send-${index}`);
    }
    await tracker.stop();

    const rows = [row(files, "conversations.send receipt", sends)];
    for (const mode of ["checkout", "worktree"] satisfies readonly WorkspaceMode[]) {
      const starts: number[] = [];
      for (let index = 0; index < RUNS; index += 1) {
        const requestId = `start-${mode}-${index}`;
        const startedAt = performance.now();
        const thread = await core.conversations.start({
          projectId: project.id,
          text: `benchmark ${mode} start`,
          requestId,
          workspace: mode,
          model: { provider: model.provider, modelId: model.modelId },
          executor: "pi",
        });
        starts.push(roundMs(performance.now() - startedAt));
        await waitForIdleRun(core, thread.id);
        await waitForAfterCheckpoint(core, thread.id, requestId);
      }
      rows.push(row(files, `conversations.start ${mode} receipt`, starts));
    }
    return rows;
  } finally {
    await close();
    closeHarnesses.splice(closeHarnesses.indexOf(close), 1);
  }
}

const benchmarkEnabled = process.env.TAU_BENCH === "1";
const roots: string[] = [];
const closeHarnesses: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closeHarnesses.splice(0).reverse()) await close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe.skipIf(!benchmarkEnabled)("conversation receipt latency benchmark", () => {
  it("prints snapshot, send, and start timing samples for increasing repository sizes", async () => {
    const rows: BenchmarkRow[] = [];
    for (const files of REPOSITORY_SIZES) {
      const root = await mkdtemp(join(tmpdir(), "tau-send-latency-"));
      roots.push(root);
      const snapshotRepo = join(root, "snapshot-repo");
      const coreRepo = join(root, "core-repo");
      await makeRepository(snapshotRepo, files);
      await makeRepository(coreRepo, files);

      const snapshotRows = await recordSnapshotSamples(root, snapshotRepo, files);
      rows.push(...snapshotRows);
      rows.push(...(await recordConversationSamples(join(root, `run-${files}`), coreRepo, files)));
    }

    console.log(JSON.stringify({ runsPerOperation: RUNS, results: rows }, null, 2));
  }, 600_000);
});
