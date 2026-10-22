import { AppError, type Project } from "@tau/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyWorkspace } from "../../harness/conversation-index";
import { listNativeConversations } from "../../harness/conversation-native";
import { createConversationStore } from "../../harness/conversation-store";
import { createRuntimeStore, type RuntimeStore } from "../../harness/runtime-store";
import {
  createPassiveThread,
  openRuntimeWorld,
  type RuntimeWorld,
} from "../../harness/runtime-store-fixture";
import { waitUntilTrue } from "../../test-support/conversation-harness";
import { useTempDir } from "../../test-support/temp-dir";
import { createWriterBarrier } from "../../workspaces/writer-barrier";
import type { NativeQueryFn } from "./controller";
import { createNativeService, type NativeService } from "./service";
import { nativeWriterPort, writerStateOfInspection } from "./writer-state";

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

async function openWorld() {
  const directory = await tempDir();
  const runtime = await openRuntimeWorld(directory);
  open.push(runtime);
  const conversations = createConversationStore(runtime.harness, async () => directory);
  const project: Project = {
    id: "p1",
    name: "main",
    path: directory,
    createdAt: 0,
    kind: "folder",
    status: "ready",
    isGitRepo: false,
  };
  const service = (
    query: NativeQueryFn = answer("done"),
    extra: Partial<Parameters<typeof createNativeService>[0]> = {},
  ) => {
    const created = createNativeService({
      harness: runtime.harness,
      conversations,
      query,
      onChange: () => undefined,
      ...extra,
    });
    services.push(created);
    return created;
  };
  return { runtime, directory, project, conversations, service };
}

const request = (id: string, text = "hello") => ({ text, requestId: id });

describe("writerStateOfInspection", () => {
  it("lets a cancel in flight win over a running lifecycle but never over unknown", () => {
    expect(writerStateOfInspection({ lifecycle: "running", cancelsInFlight: 1 })).toBe("cancelling");
    expect(writerStateOfInspection({ lifecycle: "outcome-unknown", cancelsInFlight: 1 })).toBe("unknown");
    expect(writerStateOfInspection({ lifecycle: undefined, cancelsInFlight: 0 })).toBe("unknown");
  });
});

describe("NativeService.writerStateOf against a real store", () => {
  async function storeWorld() {
    const world = await openWorld();
    const threadId = await createPassiveThread(world.runtime);
    const store = createRuntimeStore(world.runtime.harness, threadId);
    const service = world.service(answer("done"), { createStore: () => store });
    const admit = () => store.admit({ threadId, requestId: "r1", payload: payloadOf() });
    return { ...world, threadId, store, service, admit };
  }

  const payloadOf = () => ({
    text: "hi",
    attachmentIds: [],
    origin: "user" as const,
    delivery: "queue" as const,
  });

  async function toRunning(store: RuntimeStore, operationId = "op1") {
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId, nonce: `${operationId}-nonce` });
    await store.setLifecycle("running");
  }

  it("is unknown for a thread that never wrote a lifecycle, never settled", async () => {
    const { service, threadId } = await storeWorld();
    expect(await service.writerStateOf(threadId)).toBe("unknown");
  });

  it.each([
    ["accepted", [], "running"],
    ["preparing", ["preparing"], "running"],
    ["ready", ["preparing", "ready"], "running"],
    ["blocked", ["preparing", "blocked"], "settled"],
  ] as const)("maps the pre-launch lifecycle %s to %s", async (_name, steps, expected) => {
    const { service, threadId, store, admit } = await storeWorld();
    await admit();
    for (const step of steps) await store.setLifecycle(step);
    expect(await service.writerStateOf(threadId)).toBe(expected);
  });

  it("maps starting and running to running", async () => {
    const { service, threadId, store, admit } = await storeWorld();
    await admit();
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
    expect(await service.writerStateOf(threadId)).toBe("running");
    await store.setLifecycle("running");
    expect(await service.writerStateOf(threadId)).toBe("running");
  });

  it("maps a recorded cancel to cancelling until it settles", async () => {
    const { service, threadId, store, admit } = await storeWorld();
    await admit();
    await toRunning(store);
    await store.recordCancel("op1");
    expect(await service.writerStateOf(threadId)).toBe("cancelling");
    await store.settleCancels();
    expect(await service.writerStateOf(threadId)).toBe("settled");
  });

  it("maps a restart into reconciling", async () => {
    const { service, threadId, store, admit } = await storeWorld();
    await admit();
    await toRunning(store);
    await store.setLifecycle("reconciling", { restart: true });
    expect(await service.writerStateOf(threadId)).toBe("reconciling");
  });

  it.each(["completed", "failed", "cancelled", "interrupted"] as const)(
    "maps the terminal outcome %s to settled",
    async (outcome) => {
      const { service, threadId, store, admit } = await storeWorld();
      await admit();
      await toRunning(store);
      await store.settle(outcome);
      expect(await service.writerStateOf(threadId)).toBe("settled");
    },
  );

  it("keeps an unacknowledged and an acknowledged outcome-unknown unknown, until a new run begins", async () => {
    const { service, threadId, store, admit } = await storeWorld();
    await admit();
    await toRunning(store);
    await store.settle("outcome-unknown", "gone");
    expect(await service.writerStateOf(threadId)).toBe("unknown");
    await store.acknowledgeUnknown({ operationId: "op1", note: "checked the logs" });
    expect(await service.writerStateOf(threadId)).toBe("unknown");
    await store.beginOperation();
    expect(await service.writerStateOf(threadId)).toBe("running");
  });

  it("is unknown when the store cannot be read", async () => {
    const world = await openWorld();
    const broken = { inspect: () => Promise.reject(new Error("db down")) } as unknown as RuntimeStore;
    const service = world.service(answer("done"), { createStore: () => broken });
    expect(await service.writerStateOf("1")).toBe("unknown");
  });

  it("is unknown for a container that does not exist", async () => {
    const world = await openWorld();
    expect(await world.service().writerStateOf("987654")).toBe("unknown");
  });
});

describe("NativeService.writerStateOf with a live run", () => {
  it("reports running while the pump runs and settled after a cancel", async () => {
    const world = await openWorld();
    const service = world.service(neverEndingQuery());
    const summary = await service.startThread({
      project: world.project,
      input: request("held-1"),
      workspace: legacyWorkspace(world.directory),
      now: 1,
    });
    await waitUntilTrue(
      async () => (await service.writerStateOf(summary.id)) === "running",
      "the run to be reported running",
    );
    await service.cancel(summary.id);
    await service.settled();
    expect(await service.writerStateOf(summary.id)).toBe("settled");
  });
});

describe("nativeWriterPort", () => {
  const thread = { id: "7" } as never;

  it("answers undefined for a thread that is not native", async () => {
    const port = nativeWriterPort(() => ({
      isNative: async () => false,
      writerStateOf: async () => "running",
    }));
    expect(await port(thread)).toBeUndefined();
  });

  it("answers the native writer state for a native thread", async () => {
    const port = nativeWriterPort(() => ({
      isNative: async () => true,
      writerStateOf: async (id) => (id === "7" ? "reconciling" : "settled"),
    }));
    expect(await port(thread)).toBe("reconciling");
  });

  it("is unknown before the native service exists", async () => {
    expect(await nativeWriterPort(() => undefined)(thread)).toBe("unknown");
  });
});

describe("native admission and the workspace barrier", () => {
  async function fencedWorld() {
    const world = await openWorld();
    const fence = createWriterBarrier();
    const queries = vi.fn(answer("done"));
    const service = world.service(queries, { workspaceFence: fence });
    const start = (id: string) =>
      service.startThread({
        project: world.project,
        input: request(id),
        workspace: legacyWorkspace(world.directory),
        now: 1,
      });
    return { ...world, fence, queries, service, start };
  }

  const holdBarrier = (fence: ReturnType<typeof createWriterBarrier>, key: string) => {
    let release: () => void = () => undefined;
    const held = fence.run(key, "merger", () => new Promise<void>((resolve) => (release = resolve)));
    return async () => {
      release();
      await held;
    };
  };

  it("refuses a native send during a barrier with no admission and no run", async () => {
    const world = await fencedWorld();
    const summary = await world.start("s-1");
    await world.service.settled();
    const store = createRuntimeStore(world.runtime.harness, summary.id);
    const before = await store.inspect();
    const eventsBefore = (await store.events()).length;
    const callsBefore = world.queries.mock.calls.length;
    const release = holdBarrier(world.fence, world.directory);

    await expect(world.service.send(summary.id, request("s-2", "again"))).rejects.toMatchObject({
      code: "thread_busy",
    });
    await world.service.settled();

    expect(await store.inspect()).toEqual(before);
    expect((await store.events()).length).toBe(eventsBefore);
    expect(await store.pending()).toEqual([]);
    expect(world.queries.mock.calls.length).toBe(callsBefore);
    await release();
    await world.service.send(summary.id, request("s-2", "again"));
    await world.service.settled();
    expect(world.queries.mock.calls.length).toBe(callsBefore + 1);
  });

  it("refuses to start a native thread into a workspace under a barrier, creating nothing", async () => {
    const world = await fencedWorld();
    const release = holdBarrier(world.fence, world.directory);
    await expect(world.start("start-1")).rejects.toMatchObject({ code: "thread_busy" });
    expect(await listNativeConversations(world.runtime.harness)).toEqual([]);
    expect(world.queries).not.toHaveBeenCalled();
    await release();
  });

  it("does not fence the thread that owns the barrier", async () => {
    const world = await fencedWorld();
    const summary = await world.start("own-1");
    await world.service.settled();
    const owned = world.fence.run(world.directory, summary.id, async () => {
      await world.service.send(summary.id, request("own-2", "again"));
    });
    await owned;
    await world.service.settled();
    expect(world.queries.mock.calls.length).toBe(2);
  });

  it("blocks the launch when the barrier closes between admission and launch, keeping the message", async () => {
    const world = await openWorld();
    let checks = 0;
    const fence = {
      assertOpen: () => {
        checks += 1;
        if (checks > 1) throw new AppError("thread_busy", "fenced");
      },
    };
    const queries = vi.fn(answer("done"));
    const service = world.service(queries, { workspaceFence: fence });
    const summary = await service.startThread({
      project: world.project,
      input: request("late-1"),
      workspace: legacyWorkspace(world.directory),
      now: 1,
    });
    await service.settled();
    const store = createRuntimeStore(world.runtime.harness, summary.id);
    expect(queries).not.toHaveBeenCalled();
    expect((await store.operationState()).lifecycle).toBe("blocked");
    expect(await store.pending()).toHaveLength(1);
    expect(await service.writerStateOf(summary.id)).toBe("settled");
  });
});
