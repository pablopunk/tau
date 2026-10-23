import type { Project } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createChangeEmitter } from "./change-emitter";
import { createConversationsApi } from "./conversations-api";
import { legacyWorkspace } from "./harness/conversation-index";
import { createConversationStore } from "./harness/conversation-store";
import { isBusy } from "./harness/live-state";
import { BACKGROUND } from "./harness/open";
import { createRuntimeStore } from "./harness/runtime-store";
import { modelCallsOf, openRuntimeWorld, type RuntimeWorld } from "./harness/runtime-store-fixture";
import type { NativeQueryFn } from "./runtimes/native/controller";
import { createNativeService, type NativeService } from "./runtimes/native/service";
import { FAUX_MODEL, waitUntilTrue } from "./test-support/conversation-harness";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
const open: RuntimeWorld[] = [];
const services: NativeService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close().catch(() => undefined)));
  await Promise.all(open.splice(0).map((world) => world.close().catch(() => undefined)));
});

const answer = (text: string): NativeQueryFn => {
  let turns = 0;
  return () => {
    turns += 1;
    const uuid = `turn-${turns}`;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "fake-session", uuid: `${uuid}-init` };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: text,
        session_id: "fake-session",
        uuid: `${uuid}-result`,
      };
    })();
  };
};

function neverEndingQuery(): NativeQueryFn {
  return () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const messages = (async function* () {
      yield { type: "system", subtype: "init", session_id: "held-session", uuid: "u-init" };
      await held;
    })();
    return Object.assign(messages, { interrupt: async () => release(), close: () => release() });
  };
}

interface Spies {
  readonly calls: string[];
}

interface World {
  readonly runtime: RuntimeWorld;
  readonly project: Project;
  readonly spies: Spies;
  readonly store: ReturnType<typeof createConversationStore>;
  api(withNative: boolean, query?: NativeQueryFn): ReturnType<typeof createConversationsApi>;
  service(query?: NativeQueryFn): NativeService;
}

async function openWorld(): Promise<World> {
  const directory = await tempDir();
  const runtime = await openRuntimeWorld(directory);
  open.push(runtime);
  const store = createConversationStore(runtime.harness, async () => directory);
  const project: Project = {
    id: "p1",
    name: "main",
    path: directory,
    createdAt: 0,
    kind: "folder",
    status: "ready",
    isGitRepo: false,
  };
  const spies: Spies = { calls: [] };
  const spy =
    (name: string, result?: unknown) =>
    (..._args: unknown[]) => {
      spies.calls.push(name);
      return Promise.resolve(result);
    };
  const service = (query: NativeQueryFn = answer("native answer")): NativeService => {
    const created = createNativeService({
      harness: runtime.harness,
      conversations: store,
      query,
      onChange: () => undefined,
    });
    services.push(created);
    return created;
  };
  const api = (withNative: boolean, query?: NativeQueryFn) =>
    createConversationsApi({
      conversations: store,
      projects: { require: async () => project, list: async () => [project] } as never,
      provider: { isConfigured: async () => true, models: runtime.setup.models } as never,
      settings: {
        get: async () => ({ workspaceDefault: "checkout", messageMode: "steer" }),
        setLastWorkspaceMode: async () => undefined,
        lastWorkspaceMode: async () => undefined,
      } as never,
      titles: { generateFor: spy("titles.generateFor") } as never,
      status: {} as never,
      workspaces: { create: async () => legacyWorkspace(directory) } as never,
      checkpoints: {
        snapshotBefore: spy("checkpoints.snapshotBefore"),
        preview: spy("checkpoints.preview"),
        rewind: spy("checkpoints.rewind"),
        list: spy("checkpoints.list", []),
        diff: spy("checkpoints.diff"),
      } as never,
      forker: { fork: spy("forker.fork") } as never,
      harness: runtime.harness,
      removal: { remove: async () => undefined } as never,
      archivedCleanup: {} as never,
      closeClaudeCliThread: async () => undefined,
      bang: {} as never,
      changes: createChangeEmitter(),
      notifications: { notify: spy("notifications.notify") } as never,
      now: Date.now,
      ...(withNative && { native: service(query) }),
    });
  return { runtime, project, spies, store, api, service };
}

const submissionCount = async (world: World) =>
  (await world.runtime.harness.inspect(BACKGROUND)).submissions.length;

const waitForResultCount = (world: World, threadId: string, count: number) =>
  waitUntilTrue(
    async () =>
      (await createRuntimeStore(world.runtime.harness, threadId).events()).filter(
        (entry) => entry.event.type === "result",
      ).length === count,
    `${count} native result(s)`,
  );

async function startPiThread(world: World, api: ReturnType<typeof createConversationsApi>) {
  const summary = await api.start({
    projectId: "p1",
    text: "hello pi",
    requestId: "pi-start",
    model: FAUX_MODEL,
  });
  await waitUntilTrue(
    async () =>
      modelCallsOf(world.runtime.setup) > 0 &&
      !(await isBusy(world.runtime.harness, Number(summary.id) as never)),
    "the Pi run to end",
  );
  return summary;
}

const nativeStart = (overrides: Record<string, unknown> = {}) => ({
  projectId: "p1",
  text: "hello native",
  requestId: "wire-1",
  executor: "claude-code" as const,
  ...overrides,
});

const expectNoSideEffects = async (world: World) => {
  expect(await world.store.list("p1")).toHaveLength(0);
  expect(await submissionCount(world)).toBe(0);
  expect(modelCallsOf(world.runtime.setup)).toBe(0);
  expect(world.spies.calls).toEqual([]);
};

describe("conversations api start with an explicit executor", () => {
  it("rejects claude-code when native is off, creating nothing and calling no model", async () => {
    const world = await openWorld();

    await expect(world.api(false).start(nativeStart())).rejects.toMatchObject({
      code: "invalid_request",
      message: "native Claude is not enabled on this node",
    });

    await expectNoSideEffects(world);
  });

  it("starts a native thread from the wire start when native is on", async () => {
    const world = await openWorld();
    const api = world.api(true);

    const summary = await api.start(nativeStart({ model: FAUX_MODEL, thinkingLevel: "high" }));

    expect(summary).toMatchObject({ executor: "claude-code", model: null, title: "hello native" });
    await waitForResultCount(world, summary.id, 1);
    expect((await api.start(nativeStart())).id).toBe(summary.id);
    expect(await world.store.list("p1")).toHaveLength(1);
    expect(modelCallsOf(world.runtime.setup)).toBe(0);
    expect(await submissionCount(world)).toBe(0);
  });

  it.each([
    ["images", { images: [{ mimeType: "image/png", data: "AAAA" }] }],
    ["files", { files: [{ name: "a.txt", path: "uploads/a.txt", size: 1 }] }],
  ])("rejects %s on a native start before any side effect", async (_name, attachment) => {
    const world = await openWorld();

    await expect(world.api(true).start(nativeStart(attachment))).rejects.toMatchObject({
      code: "invalid_request",
      message: "attachments are not supported for native threads yet",
    });

    await expectNoSideEffects(world);
  });

  it.each([
    ["omitted", {}],
    ["pi", { executor: "pi" }],
  ])("keeps the legacy Pi start when the executor is %s, with native on or off", async (_name, extra) => {
    for (const withNative of [false, true]) {
      const world = await openWorld();
      const api = world.api(withNative);
      const summary = await api.start({
        projectId: "p1",
        text: "hello pi",
        requestId: "pi-start",
        model: FAUX_MODEL,
        ...extra,
      } as never);
      await waitUntilTrue(
        async () =>
          modelCallsOf(world.runtime.setup) > 0 &&
          !(await isBusy(world.runtime.harness, Number(summary.id) as never)),
        "the Pi run to end",
      );

      expect(summary.executor).toBeUndefined();
      expect(summary.model).not.toBeNull();
    }
  });
});

describe("conversations api with the native flag off", () => {
  it("exposes no native entry point and leaves a Pi thread untouched", async () => {
    const world = await openWorld();
    const api = world.api(false);

    expect(api.startNative).toBeUndefined();
    const summary = await startPiThread(world, api);
    const calls = modelCallsOf(world.runtime.setup);
    expect(calls).toBeGreaterThan(0);
    expect(summary.executor).toBeUndefined();

    const receipt = await api.send(summary.id, { text: "again", requestId: "pi-2" });
    expect(receipt.submissionId).toEqual(expect.any(Number));
    await waitUntilTrue(async () => modelCallsOf(world.runtime.setup) > calls, "a second model call");
  });

  it("keeps exactly the same method names, plus startNative only when native is wired", async () => {
    const world = await openWorld();
    const off = Object.keys(world.api(false)).sort();
    const on = Object.keys(world.api(true)).sort();

    expect(on).toEqual([...off, "startNative"].sort());
  });

  it("treats a native-marked container as a legacy thread: no model, so the send is refused as before", async () => {
    const world = await openWorld();
    const native = await world.service().startThread({
      project: { id: "p1", path: world.project.path },
      input: { text: "marked", requestId: "marked" },
      workspace: legacyWorkspace(world.project.path),
      now: 1,
    });
    const api = world.api(false);
    const before = await submissionCount(world);

    await expect(api.send(native.id, { text: "hello", requestId: "legacy-1" })).rejects.toMatchObject({
      code: "invalid_request",
      message: "This thread has no model.",
    });

    expect(await submissionCount(world)).toBe(before);
    expect(modelCallsOf(world.runtime.setup)).toBe(0);
  });
});

describe("conversations api with the native flag on", () => {
  it("starts a native thread at the core level, runs it, and never touches Pi or the title model", async () => {
    const world = await openWorld();
    const api = world.api(true);

    const summary = await api.startNative?.({ projectId: "p1", text: "hello native", requestId: "n-start" });

    expect(summary).toMatchObject({ executor: "claude-code", model: null, title: "hello native" });
    const threadId = summary?.id ?? "";
    await waitForResultCount(world, threadId, 1);
    const again = await api.startNative?.({ projectId: "p1", text: "hello native", requestId: "n-start" });
    expect(again?.id).toBe(threadId);
    expect(await world.store.list("p1")).toHaveLength(1);
    expect(modelCallsOf(world.runtime.setup)).toBe(0);
    expect(await submissionCount(world)).toBe(0);
    expect(world.spies.calls).toEqual([]);
  });

  it("routes send on a native thread to the native service", async () => {
    const world = await openWorld();
    const api = world.api(true);
    const threadId = (await api.startNative?.({ projectId: "p1", text: "one", requestId: "n-1" }))?.id ?? "";
    await waitForResultCount(world, threadId, 1);

    const receipt = await api.send(threadId, { text: "two", requestId: "n-2" });

    expect(receipt.submissionId).toBeGreaterThan(0);
    await waitForResultCount(world, threadId, 2);
    expect(modelCallsOf(world.runtime.setup)).toBe(0);
    expect(await submissionCount(world)).toBe(0);
    expect(world.spies.calls).toEqual([]);
  });

  const unsupported: [
    string,
    string,
    (api: ReturnType<typeof createConversationsApi>, id: string) => Promise<unknown>,
  ][] = [
    ["retry", "retry", (api, id) => api.retry(id, { requestId: "r" })],
    ["sendNow", "send now", (api, id) => api.sendNow(id, "1")],
    ["configure", "changing the model", (api, id) => api.configure(id, { model: FAUX_MODEL })],
    ["compact", "compaction", (api, id) => api.compact(id, { instructions: "short" })],
    ["fork", "fork", (api, id) => api.fork(id, "e1")],
    ["rewind", "rewind", (api, id) => api.rewind(id, "e1")],
    ["rewindPreview", "rewind", (api, id) => api.rewindPreview(id, "e1")],
    ["cancelQueued", "editing queued messages", (api, id) => api.cancelQueued(id, "1")],
    ["setQueuedMode", "editing queued messages", (api, id) => api.setQueuedMode(id, "1", "steer")],
    [
      "updateTodos",
      "todo updates",
      (api, id) => api.updateTodos(id, { requestId: "t", todos: [{ content: "x", status: "pending" }] }),
    ],
    ["stopAgent", "stopping subagents", (api, id) => api.stopAgent(id)],
  ];

  it.each(unsupported)(
    "rejects %s on a native thread naming the capability, with no side effect",
    async (_name, capability, call) => {
      const world = await openWorld();
      const api = world.api(true);
      const threadId =
        (await api.startNative?.({ projectId: "p1", text: "one", requestId: "n-1" }))?.id ?? "";
      await waitForResultCount(world, threadId, 1);
      const store = createRuntimeStore(world.runtime.harness, threadId);
      const windowBefore = await store.window();
      const submissionsBefore = await submissionCount(world);
      const summaryBefore = await world.store.find(threadId);

      await expect(call(api, threadId)).rejects.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining(capability),
      });

      expect(await store.window()).toEqual(windowBefore);
      expect(await submissionCount(world)).toBe(submissionsBefore);
      expect(await world.store.find(threadId)).toEqual(summaryBefore);
      expect(world.spies.calls).toEqual([]);
      expect(modelCallsOf(world.runtime.setup)).toBe(0);
    },
  );

  it("routes stop to the native cancel and answers like an abort", async () => {
    const world = await openWorld();
    const api = world.api(true, neverEndingQuery());
    const threadId =
      (await api.startNative?.({ projectId: "p1", text: "long", requestId: "n-long" }))?.id ?? "";
    const store = createRuntimeStore(world.runtime.harness, threadId);
    await waitUntilTrue(
      async () => (await store.operationState()).operation !== undefined,
      "the run to start",
    );

    const result = await api.abort(threadId);

    expect(result).toEqual({ restored: [] });
    expect((await store.operationState()).lifecycle).toBe("cancelled");
    expect(modelCallsOf(world.runtime.setup)).toBe(0);
  });

  it("stops a running native thread before it is removed", async () => {
    const world = await openWorld();
    const api = world.api(true, neverEndingQuery());
    const threadId =
      (await api.startNative?.({ projectId: "p1", text: "long", requestId: "n-long" }))?.id ?? "";
    const store = createRuntimeStore(world.runtime.harness, threadId);
    await waitUntilTrue(
      async () => (await store.operationState()).operation !== undefined,
      "the run to start",
    );

    await api.remove(threadId);

    expect((await store.operationState()).lifecycle).toBe("cancelled");
  });

  it("leaves a Pi thread fully working: send, abort, model change", async () => {
    const world = await openWorld();
    const api = world.api(true);
    const summary = await startPiThread(world, api);
    const calls = modelCallsOf(world.runtime.setup);

    await api.send(summary.id, { text: "again", requestId: "pi-2" });
    await waitUntilTrue(async () => modelCallsOf(world.runtime.setup) > calls, "a second Pi model call");
    await api.configure(summary.id, { model: { provider: "faux", modelId: "faux-2" } });
    await api.abort(summary.id);

    expect(await world.store.modelOf(summary.id)).toMatchObject({ modelId: "faux-2" });
    expect((await world.store.find(summary.id))?.executor).toBeUndefined();
    const retry = await api.retry(summary.id, { requestId: "retry-1" }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(retry?.message ?? "").not.toContain("Native");
  });
});
