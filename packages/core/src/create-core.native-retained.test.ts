import { existsSync } from "node:fs";
import { applyImmutable } from "@earendil-works/chord/delta";
import {
  type ConversationSummary,
  type ConversationView,
  type Core,
  isSafeToDestroy,
  nativeEventsOf,
} from "@tau/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CoreDependencies, createCoreWith, defaultCoreDependencies } from "./create-core";
import { legacyWorkspace } from "./harness/conversation-index";
import { createNativeConversation } from "./harness/conversation-native";
import { createRuntimeStore } from "./harness/runtime-store";
import { openRuntimeWorld } from "./harness/runtime-store-fixture";
import { ensureRuntimeFormat, runtimeFormatPath } from "./home/runtime-format-file";
import type { NativeQueryFn } from "./runtimes/native/controller";
import { RETAINED_REASON } from "./runtimes/native/native-mode";
import { homeIn, useTempDir } from "./test-support/temp-dir";
import { NO_UPDATE_OPTIONS } from "./test-support/update-options";
import { createWorkspaceService, type WorkspaceDeps } from "./workspaces/workspace-service";

vi.mock("./workspaces/workspace-service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./workspaces/workspace-service")>();
  return { ...original, createWorkspaceService: vi.fn(original.createWorkspaceService) };
});

const tempDir = useTempDir();
const cores: Core[] = [];
const CLAUDE_INSTALLED: Partial<CoreDependencies> = { claudeCodeInstalled: async () => true };

afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close()));
  vi.mocked(createWorkspaceService).mockClear();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

function countedAnswer() {
  let runs = 0;
  const query: NativeQueryFn = () => {
    runs += 1;
    const uuid = `run-${runs}`;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "core-session", uuid: `${uuid}-init` };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ok",
        session_id: "core-session",
        uuid: `${uuid}-result`,
      };
    })();
  };
  return { query, runs: () => runs };
}

const startNativeOf = (core: Core) =>
  (core.conversations as { startNative?: (input: unknown) => Promise<ConversationSummary> }).startNative;

async function openCore(
  root: string,
  env: Record<string, string>,
  nativeQuery: NativeQueryFn,
  installed: Partial<CoreDependencies> = {},
) {
  const core = await createCoreWith(
    { home: homeIn(root), faux: true, ...NO_UPDATE_OPTIONS },
    { ...defaultCoreDependencies(), env, ...installed, nativeQuery },
  );
  cores.push(core);
  return core;
}

async function closeCore(core: Core): Promise<void> {
  await core.close();
  cores.splice(cores.indexOf(core), 1);
}

const executorsOf = async (core: Core) =>
  Object.fromEntries((await core.runtimes.list()).executors.map((entry) => [entry.executor, entry]));

const summaryOf = async (core: Core, projectId: string, id: string) =>
  (await core.conversations.list(projectId)).find((thread) => thread.id === id);

async function viewOf(core: Core, id: string): Promise<ConversationView> {
  let view: ConversationView | null | undefined;
  const watcher = await core.conversations.watch(id, async (ops) => {
    view = applyImmutable<ConversationView | null>(view, ops);
  });
  const seen = await waitFor(async () => view ?? undefined, "the first frame");
  await watcher.stop();
  return seen;
}

const writerPortOf = (): NonNullable<WorkspaceDeps["writerStateOf"]> | undefined =>
  vi.mocked(createWorkspaceService).mock.calls.at(-1)?.[0].writerStateOf;

const IDENTITY = { pid: 424242, startTime: 1_700_000_000_000, nonce: "n-1", pgid: 424242 };

async function seedInFlightNativeThread(root: string, projectId: string, projectPath: string) {
  const world = await openRuntimeWorld(homeIn(root));
  try {
    await ensureRuntimeFormat(homeIn(root), Date.now);
    const { summary } = await createNativeConversation(world.harness, {
      project: { id: projectId, path: projectPath },
      input: { text: "left running", requestId: "seeded" },
      workspace: legacyWorkspace(projectPath),
      now: Date.now(),
    });
    const store = createRuntimeStore(world.harness, summary.id);
    await store.admit({
      threadId: summary.id,
      requestId: "seeded",
      payload: { text: "left running", attachmentIds: [], origin: "user", delivery: "queue" },
    });
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op-1", nonce: "n-1" });
    await store.recordIdentity(IDENTITY);
    await store.markDeliveredOnce("seeded");
    await store.markDelivered("seeded");
    await store.setLifecycle("running");
    return summary.id;
  } finally {
    await world.close();
  }
}

async function leaveNativeThreads() {
  const root = await tempDir();
  const first = countedAnswer();
  const core = await openCore(root, {}, first.query, CLAUDE_INSTALLED);
  const project = await core.projects.add({ path: root });
  const completed = await startNativeOf(core)?.({ projectId: project.id, text: "done", requestId: "n-1" });
  const completedId = completed?.id ?? "";
  await waitFor(
    async () => (await summaryOf(core, project.id, completedId))?.lastRunEndedAt ?? undefined,
    "run",
  );
  await closeCore(core);
  const inFlightId = await seedInFlightNativeThread(root, project.id, root);
  return { root, project, completedId, inFlightId, firstRuns: first.runs() };
}

describe("createCore without Claude Code while native threads exist", () => {
  it("keeps the threads, their transcript and their lifecycle readable, and never relaunches", async () => {
    const { root, project, completedId, inFlightId } = await leaveNativeThreads();
    const retained = countedAnswer();

    const core = await openCore(root, {}, retained.query);
    await sleep(200);

    expect(await summaryOf(core, project.id, completedId)).toMatchObject({ executor: "claude-code" });
    expect(await summaryOf(core, project.id, inFlightId)).toMatchObject({
      executor: "claude-code",
      status: "error",
    });
    const events = nativeEventsOf(await viewOf(core, completedId));
    expect(events.find((event) => event.type === "user")).toMatchObject({ text: "done" });
    const lifecycles = nativeEventsOf(await viewOf(core, inFlightId)).flatMap((event) =>
      event.type === "lifecycle" ? [event.lifecycle] : [],
    );
    expect(lifecycles.at(-1)).toBe("outcome-unknown");
    expect(retained.runs()).toBe(0);
  });

  it("refuses send before any store, view or run side effect, and never reaches Pi", async () => {
    const { root, project, completedId } = await leaveNativeThreads();
    const retained = countedAnswer();
    const core = await openCore(root, {}, retained.query);
    const viewBefore = await viewOf(core, completedId);
    const summaryBefore = await summaryOf(core, project.id, completedId);

    await expect(
      core.conversations.send(completedId, { text: "again", requestId: "n-2" }),
    ).rejects.toMatchObject({ code: "invalid_request", message: RETAINED_REASON });
    await sleep(150);

    expect(await viewOf(core, completedId)).toEqual(viewBefore);
    expect(await summaryOf(core, project.id, completedId)).toEqual(summaryBefore);
    expect(retained.runs()).toBe(0);
  });

  it("refuses to start a native thread before creating a workspace, a record or the manifest", async () => {
    const root = await tempDir();
    const seeding = await openCore(root, {}, countedAnswer().query, CLAUDE_INSTALLED);
    const project = await seeding.projects.add({ path: root });
    await closeCore(seeding);
    await ensureRuntimeFormat(homeIn(root), Date.now);
    const retained = countedAnswer();
    const core = await openCore(root, {}, retained.query);

    await expect(
      core.conversations.start({
        projectId: project.id,
        text: "hello",
        requestId: "n-9",
        executor: "claude-code",
      }),
    ).rejects.toMatchObject({ code: "invalid_request", message: RETAINED_REASON });
    await expect(
      startNativeOf(core)?.({ projectId: project.id, text: "hello", requestId: "n-10" }),
    ).rejects.toMatchObject({ code: "invalid_request", message: RETAINED_REASON });

    expect((await core.conversations.list(project.id)).length).toBe(0);
    expect(retained.runs()).toBe(0);
  });

  it("lists claude-code as disabled with the read-only reason and leaves Pi unchanged", async () => {
    const { root } = await leaveNativeThreads();

    const executors = await executorsOf(await openCore(root, {}, countedAnswer().query));

    expect(executors.pi).toMatchObject({ enabled: true });
    expect(executors["claude-code"]).toMatchObject({ enabled: false, reason: RETAINED_REASON });
    expect(executors["claude-code"]?.capabilities.followUp.supported).toBe(false);
  });

  it("keeps cancel working: the stop of a thread left in flight settles it without a relaunch", async () => {
    const { root, project, inFlightId, completedId } = await leaveNativeThreads();
    const retained = countedAnswer();
    const core = await openCore(root, {}, retained.query);

    await expect(core.conversations.abort(inFlightId)).resolves.toEqual({ restored: [] });
    await expect(core.conversations.abort(completedId)).resolves.toEqual({ restored: [] });

    expect(await summaryOf(core, project.id, inFlightId)).toMatchObject({ executor: "claude-code" });
    expect(retained.runs()).toBe(0);
  });

  it("still reports writer states to the workspace barrier: unknown denies destruction, settled allows it", async () => {
    const { root, project, completedId, inFlightId } = await leaveNativeThreads();
    const core = await openCore(root, {}, countedAnswer().query);
    const port = writerPortOf();
    const stateOf = async (id: string) => {
      const thread = await summaryOf(core, project.id, id);
      return port?.(thread as ConversationSummary);
    };

    const unknown = await stateOf(inFlightId);
    const settled = await stateOf(completedId);

    expect(unknown).toBe("unknown");
    expect(isSafeToDestroy(unknown ?? "unknown")).toBe(false);
    expect(settled).toBe("settled");
    expect(isSafeToDestroy(settled ?? "unknown")).toBe(true);
    expect(await port?.({ id: "999999" } as ConversationSummary)).toBeUndefined();
  });

  it("resumes normal behavior on the same threads when Claude Code is installed again", async () => {
    const { root, project, completedId } = await leaveNativeThreads();
    const retained = await openCore(root, {}, countedAnswer().query);
    await closeCore(retained);
    const resumed = countedAnswer();

    const core = await openCore(root, {}, resumed.query, CLAUDE_INSTALLED);
    await core.conversations.send(completedId, { text: "welcome back", requestId: "n-3" });
    await waitFor(async () => (resumed.runs() === 1 ? true : undefined), "the resumed run");

    expect((await executorsOf(core))["claude-code"]).toMatchObject({ enabled: true });
    expect((await executorsOf(core))["claude-code"]?.reason).toBeUndefined();
    expect(await summaryOf(core, project.id, completedId)).toMatchObject({ executor: "claude-code" });
    const started = await startNativeOf(core)?.({ projectId: project.id, text: "new", requestId: "n-4" });
    expect(started).toMatchObject({ executor: "claude-code" });
  });
});

describe("createCore without Claude Code and no native state", () => {
  it("creates no native service and touches no file", async () => {
    const root = await tempDir();
    const counted = countedAnswer();

    const core = await openCore(root, {}, counted.query);
    const executors = await executorsOf(core);
    await closeCore(core);

    expect(startNativeOf(core)).toBeUndefined();
    expect(executors["claude-code"]).toMatchObject({
      enabled: false,
      reason: "Claude Code is not installed on this node",
    });
    expect(existsSync(runtimeFormatPath(homeIn(root)))).toBe(false);
    expect("writerStateOf" in (vi.mocked(createWorkspaceService).mock.calls.at(-1)?.[0] ?? {})).toBe(false);
    expect(counted.runs()).toBe(0);
  });
});
