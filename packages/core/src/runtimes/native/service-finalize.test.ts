import type { SendMessageInput } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { legacyWorkspace } from "../../harness/conversation-index";
import { createNativeConversation } from "../../harness/conversation-native";
import { type ConversationStore, createConversationStore } from "../../harness/conversation-store";
import { createRuntimeStore, type RuntimeStore } from "../../harness/runtime-store";
import { openRuntimeWorld, type RuntimeWorld } from "../../harness/runtime-store-fixture";
import { useTempDir } from "../../test-support/temp-dir";
import type { SupervisorDeps } from "../supervisor";
import type { NativeQueryFn } from "./controller";
import type { NativeCheckpointPort } from "./finalize";
import { createNativeService, type NativeService } from "./service";

const tempDir = useTempDir();
const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}

const input = (text: string, requestId: string): SendMessageInput => ({ text, requestId });

const answering = (): { query: NativeQueryFn; runs: () => number } => {
  let runs = 0;
  return {
    runs: () => runs,
    query: () => {
      runs += 1;
      const uuid = `turn-${runs}`;
      return (async function* () {
        yield { type: "system", subtype: "init", session_id: "fake-session", uuid: `${uuid}-init` };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "fake-session",
          uuid: `${uuid}-result`,
        };
      })();
    },
  };
};

const hangingQuery: NativeQueryFn = () => {
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

interface FakeCheckpoints extends NativeCheckpointPort {
  applicable: boolean;
  working: boolean;
  readonly befores: string[];
  readonly afters: string[];
}

function fakeCheckpoints(): FakeCheckpoints {
  const recorded = new Set<string>();
  const fake: FakeCheckpoints = {
    applicable: true,
    working: true,
    befores: [],
    afters: [],
    applies: async () => fake.applicable,
    snapshotBefore: async (_threadId, requestId) => {
      fake.befores.push(requestId);
      if (fake.working) recorded.add(requestId);
    },
    hasBefore: async (_threadId, requestId) => recorded.has(requestId),
    snapshotAfter: async (_threadId, operationId) => {
      fake.afters.push(operationId);
    },
  };
  return fake;
}

interface Rig {
  readonly runtime: RuntimeWorld;
  readonly conversations: ConversationStore;
  readonly service: NativeService;
  readonly changes: string[];
  readonly directory: string;
  storeOf(threadId: string): RuntimeStore;
  start(requestId?: string): Promise<string>;
}

interface RigOptions {
  readonly query: NativeQueryFn;
  readonly checkpoints?: NativeCheckpointPort;
  readonly ensureFormat?: () => Promise<void>;
  readonly supervisor?: Partial<SupervisorDeps>;
}

function assemble(runtime: RuntimeWorld, directory: string, options: RigOptions): Rig {
  const conversations = createConversationStore(runtime.harness, async () => directory);
  const changes: string[] = [];
  const service = createNativeService({
    harness: runtime.harness,
    conversations,
    query: options.query,
    ...(options.checkpoints && { checkpoints: options.checkpoints }),
    ...(options.ensureFormat && { ensureFormat: options.ensureFormat }),
    ...(options.supervisor && { supervisor: options.supervisor }),
    onChange: (projectId) => changes.push(projectId),
  });
  cleanups.push(() => service.close());
  return {
    runtime,
    conversations,
    service,
    changes,
    directory,
    storeOf: (threadId) => createRuntimeStore(runtime.harness, threadId),
    start: async (requestId = "start-1") =>
      (
        await service.startThread({
          project: { id: "p1", path: directory },
          input: input("first message", requestId),
          workspace: legacyWorkspace(directory),
          now: Date.now(),
        })
      ).id,
  };
}

async function rigOf(options: RigOptions, directory?: string): Promise<Rig> {
  const root = directory ?? (await tempDir());
  const runtime = await openRuntimeWorld(root);
  cleanups.push(() => runtime.close().catch(() => undefined));
  return assemble(runtime, root, options);
}

const lifecycleOf = async (rig: Rig, threadId: string) =>
  (await rig.storeOf(threadId).operationState()).lifecycle;

const waitForLifecycle = (rig: Rig, threadId: string, expected: string) =>
  waitUntil(async () => (await lifecycleOf(rig, threadId)) === expected, `lifecycle ${expected}`);

const eventsOf = async (rig: Rig, threadId: string) =>
  (await rig.storeOf(threadId).events()).map((entry) => entry.event);

describe("native checkpoint before execution", () => {
  it("blocks without starting the SDK when the snapshot fails, keeps the input, and retries on the next send", async () => {
    const checkpoints = fakeCheckpoints();
    checkpoints.working = false;
    const counted = answering();
    const rig = await rigOf({ query: counted.query, checkpoints });

    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "blocked");
    await rig.service.settled();

    expect(counted.runs()).toBe(0);
    expect((await rig.storeOf(threadId).pending()).map((item) => item.requestId)).toEqual(["start-1"]);
    expect(await eventsOf(rig, threadId)).toContainEqual(
      expect.objectContaining({
        type: "notice",
        code: "blocked",
        text: expect.stringContaining("Could not take the checkpoint before the run"),
      }),
    );
    expect(await rig.conversations.find(threadId)).toMatchObject({ status: "error" });
    expect(checkpoints.befores).toEqual(["start-1"]);
    expect(checkpoints.afters).toEqual([]);

    checkpoints.working = true;
    await rig.service.send(threadId, input("second message", "send-2"));
    await waitUntil(async () => (await rig.storeOf(threadId).pending()).length === 0, "the queue to drain");
    await rig.service.settled();

    expect(counted.runs()).toBe(2);
    expect(await rig.storeOf(threadId).pending()).toEqual([]);
    expect(checkpoints.befores).toEqual(["start-1", "start-1", "send-2"]);
    expect(checkpoints.afters).toHaveLength(2);
    expect(await rig.conversations.find(threadId)).toMatchObject({ status: "idle" });
  });

  it("blocks when taking the snapshot throws", async () => {
    const checkpoints = fakeCheckpoints();
    checkpoints.snapshotBefore = async () => {
      throw new Error("repository is locked");
    };
    const counted = answering();
    const rig = await rigOf({ query: counted.query, checkpoints });

    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "blocked");
    await rig.service.settled();

    expect(counted.runs()).toBe(0);
    expect(await eventsOf(rig, threadId)).toContainEqual(
      expect.objectContaining({ code: "blocked", text: expect.stringContaining("repository is locked") }),
    );
  });

  it("proceeds without a snapshot when checkpoints do not apply to the folder", async () => {
    const checkpoints = fakeCheckpoints();
    checkpoints.applicable = false;
    const counted = answering();
    const rig = await rigOf({ query: counted.query, checkpoints });

    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "completed");
    await rig.service.settled();

    expect(counted.runs()).toBe(1);
    expect(checkpoints.befores).toEqual([]);
    expect(checkpoints.afters).toEqual([]);
  });

  it("takes the snapshot before the SDK query is created", async () => {
    const checkpoints = fakeCheckpoints();
    const order: string[] = [];
    const real = checkpoints.snapshotBefore;
    checkpoints.snapshotBefore = async (threadId, requestId) => {
      order.push("snapshot");
      await real(threadId, requestId);
    };
    const counted = answering();
    const query: NativeQueryFn = (args) => {
      order.push("query");
      return counted.query(args);
    };
    const rig = await rigOf({ query, checkpoints });

    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "completed");

    expect(order).toEqual(["snapshot", "query"]);
  });

  it("never snapshots anything when no checkpoint port is wired", async () => {
    const counted = answering();
    const rig = await rigOf({ query: counted.query });

    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "completed");

    expect(counted.runs()).toBe(1);
  });
});

describe("native finalization once per operation", () => {
  it("takes the checkpoint after exactly once even when settlement is replayed and reconciled again", async () => {
    const checkpoints = fakeCheckpoints();
    const rig = await rigOf({ query: answering().query, checkpoints });
    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "completed");
    await rig.service.settled();
    const first = (await rig.storeOf(threadId).operationState()).operation?.operationId;

    await rig.service.reconcileAll();
    await rig.service.reconcileAll();
    expect(await rig.service.cancel(threadId)).toEqual({ status: "idle" });

    expect(checkpoints.afters).toEqual([first]);
    expect((await rig.conversations.find(threadId))?.lastRunEndedAt).toEqual(expect.any(Number));

    await rig.service.send(threadId, input("again", "send-2"));
    await waitUntil(async () => checkpoints.afters.length === 2, "the second after");
    await rig.service.settled();
    expect(new Set(checkpoints.afters).size).toBe(2);
  });

  it("finalizes a cancelled operation once although both the cancel and the pump see it settle", async () => {
    const checkpoints = fakeCheckpoints();
    const rig = await rigOf({ query: hangingQuery, checkpoints });
    const threadId = await rig.start();
    await waitUntil(
      async () => (await rig.storeOf(threadId).operationState()).operation !== undefined,
      "the operation",
    );

    const result = await rig.service.cancel(threadId);
    await rig.service.settled();

    expect(result).toEqual({ status: "cancelled", outcome: "cancelled" });
    expect(checkpoints.afters).toHaveLength(1);
    expect(await rig.conversations.find(threadId)).toMatchObject({ status: "idle" });
    expect((await rig.conversations.find(threadId))?.lastRunEndedAt).toEqual(expect.any(Number));
  });

  it("marks an unknown outcome as an error, takes no checkpoint after and does no success work", async () => {
    const checkpoints = fakeCheckpoints();
    const query: NativeQueryFn = () => {
      throw new Error("the SDK refused to start");
    };
    const rig = await rigOf({ query, checkpoints });

    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "outcome-unknown");
    await rig.service.settled();
    await rig.service.reconcileAll();

    expect(checkpoints.afters).toEqual([]);
    expect(await rig.conversations.find(threadId)).toMatchObject({ status: "error" });
    expect(await eventsOf(rig, threadId)).toContainEqual(
      expect.objectContaining({ type: "notice", code: "outcome-unknown" }),
    );
  });

  it("finalizes a run found interrupted at startup once, however often startup reconciles", async () => {
    const checkpoints = fakeCheckpoints();
    const directory = await tempDir();
    const first = await rigOf({ query: answering().query }, directory);
    const { summary } = await createNativeConversation(first.runtime.harness, {
      project: { id: "p1", path: directory },
      input: input("first message", "seeded"),
      workspace: legacyWorkspace(directory),
      now: 10,
    });
    const store = first.storeOf(summary.id);
    await store.admit({
      threadId: summary.id,
      requestId: "seeded",
      payload: { text: "first message", attachmentIds: [], origin: "user", delivery: "queue" },
    });
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op-1", nonce: "n-1" });
    await store.recordIdentity({ pid: 424242, startTime: 1_700_000_000_000, nonce: "n-1", pgid: 424242 });
    await first.runtime.close();
    const reopened = await openRuntimeWorld(directory, first.runtime.setup);
    cleanups.push(() => reopened.close().catch(() => undefined));
    const supervisor: Partial<SupervisorDeps> = {
      processTable: { find: async () => undefined, list: async () => [] },
      sendSignal: () => undefined,
    };
    const counted = answering();
    const rig = assemble(reopened, directory, { query: counted.query, checkpoints, supervisor });

    const results = [await rig.service.reconcileAll(), await rig.service.reconcileAll()];

    expect(results[0]).toEqual([{ threadId: summary.id, outcome: "interrupted" }]);
    expect(checkpoints.afters).toEqual(["op-1"]);
    expect(counted.runs()).toBe(0);
    expect(await rig.conversations.find(summary.id)).toMatchObject({ status: "error" });
  });

  it("does not finalize a blocked start, which never became an operation", async () => {
    const checkpoints = fakeCheckpoints();
    checkpoints.working = false;
    const rig = await rigOf({ query: answering().query, checkpoints });

    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "blocked");
    await rig.service.settled();
    await rig.service.reconcileAll();

    expect(checkpoints.afters).toEqual([]);
  });
});

describe("native format manifest before the first record", () => {
  it("runs the format step before the conversation is created, on every start request", async () => {
    const seen: number[] = [];
    let conversations: ConversationStore | undefined;
    const ensureFormat = async () => {
      seen.push((await conversations?.list("p1"))?.length ?? -1);
    };
    const rig = await rigOf({ query: answering().query, ensureFormat });
    conversations = rig.conversations;

    await rig.start("one");
    await rig.start("two");
    await rig.service.settled();

    expect(seen).toEqual([0, 1]);
  });

  it("creates no conversation and starts nothing when the format step fails", async () => {
    const counted = answering();
    const rig = await rigOf({
      query: counted.query,
      ensureFormat: async () => {
        throw new Error("the home is not writable");
      },
    });

    await expect(rig.start()).rejects.toThrow("the home is not writable");
    await rig.service.settled();

    expect(await rig.conversations.list("p1")).toEqual([]);
    expect(counted.runs()).toBe(0);
  });

  it("does not run the format step when a message is sent to an existing thread", async () => {
    let calls = 0;
    const rig = await rigOf({
      query: answering().query,
      ensureFormat: async () => {
        calls += 1;
      },
    });
    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "completed");
    await rig.service.settled();

    await rig.service.send(threadId, input("again", "send-2"));
    await rig.service.settled();

    expect(calls).toBe(1);
  });
});
