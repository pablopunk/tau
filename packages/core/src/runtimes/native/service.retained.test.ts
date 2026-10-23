import type { Project } from "@tau/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyWorkspace } from "../../harness/conversation-index";
import { createNativeConversation, listNativeConversations } from "../../harness/conversation-native";
import { createConversationStore } from "../../harness/conversation-store";
import { createRuntimeStore, type RuntimeStore } from "../../harness/runtime-store";
import { openRuntimeWorld, type RuntimeWorld } from "../../harness/runtime-store-fixture";
import { useTempDir } from "../../test-support/temp-dir";
import type { NativeQueryFn } from "./controller";
import { RETAINED_REASON } from "./native-mode";
import { createNativeService, type NativeService } from "./service";

const tempDir = useTempDir();
const open: RuntimeWorld[] = [];
const services: NativeService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close().catch(() => undefined)));
  await Promise.all(open.splice(0).map((world) => world.close().catch(() => undefined)));
});

const request = (id: string) => ({ text: "hello", requestId: id });

async function retainedWorld() {
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
  const launched = vi.fn();
  const query: NativeQueryFn = () => {
    launched();
    throw new Error("a retained service must never launch");
  };
  const ensureFormat = vi.fn(async () => undefined);
  const signals: unknown[] = [];
  const service = createNativeService({
    harness: runtime.harness,
    conversations,
    query,
    mode: "retained",
    ensureFormat,
    supervisor: {
      processTable: { find: async () => undefined, list: async () => [] },
      sendSignal: (pid, signal) => void signals.push([pid, signal]),
    },
    onChange: () => undefined,
  });
  services.push(service);
  const storeOf = (id: string): RuntimeStore => createRuntimeStore(runtime.harness, id);
  async function seedInFlightThread(): Promise<string> {
    const { summary } = await createNativeConversation(runtime.harness, {
      project,
      input: request("seeded"),
      workspace: legacyWorkspace(directory),
      now: 10,
    });
    const store = storeOf(summary.id);
    await store.admit({
      threadId: summary.id,
      requestId: "seeded",
      payload: { text: "hello", attachmentIds: [], origin: "user", delivery: "queue" },
    });
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op-1", nonce: "n-1" });
    await store.recordIdentity({ pid: 424242, startTime: 1_700_000_000_000, nonce: "n-1", pgid: 424242 });
    await store.markDeliveredOnce("seeded");
    await store.markDelivered("seeded");
    await store.setLifecycle("running");
    return summary.id;
  }
  return { runtime, project, service, storeOf, launched, ensureFormat, signals, seedInFlightThread };
}

describe("NativeService in retained mode", () => {
  it("refuses a start before the format file, a record or a launch", async () => {
    const world = await retainedWorld();

    await expect(
      world.service.startThread({
        project: world.project,
        input: request("s-1"),
        workspace: legacyWorkspace(world.project.path),
        now: 1,
      }),
    ).rejects.toMatchObject({ code: "invalid_request", message: RETAINED_REASON });

    expect(world.service.creationEnabled).toBe(false);
    expect(world.ensureFormat).not.toHaveBeenCalled();
    expect(await listNativeConversations(world.runtime.harness)).toEqual([]);
    expect(world.launched).not.toHaveBeenCalled();
  });

  it("refuses a send to an existing native thread before admission or a pump", async () => {
    const world = await retainedWorld();
    const threadId = await world.seedInFlightThread();
    await world.service.reconcileAll();
    const before = await world.storeOf(threadId).inspect();

    await expect(world.service.send(threadId, request("later"))).rejects.toMatchObject({
      code: "invalid_request",
      message: RETAINED_REASON,
    });
    await world.service.settled();

    expect(await world.storeOf(threadId).inspect()).toEqual(before);
    expect(await world.storeOf(threadId).pending()).toEqual([]);
    expect(world.launched).not.toHaveBeenCalled();
  });

  it("reconciles at startup without a launch and still answers isNative and writerStateOf", async () => {
    const world = await retainedWorld();
    const threadId = await world.seedInFlightThread();

    const reconciled = await world.service.reconcileAll();

    expect(reconciled).toEqual([{ threadId, outcome: "outcome-unknown" }]);
    expect(await world.service.isNative(threadId)).toBe(true);
    expect(await world.service.writerStateOf(threadId)).toBe("unknown");
    expect(world.launched).not.toHaveBeenCalled();
  });

  it("cancels a run left in flight through the verified-death path, without a launch", async () => {
    const world = await retainedWorld();
    const threadId = await world.seedInFlightThread();

    const result = await world.service.cancel(threadId);

    expect(result).toMatchObject({ status: "cancelled" });
    expect((await world.storeOf(threadId).operationState()).operation?.terminal).toBeDefined();
    expect(world.launched).not.toHaveBeenCalled();
  });
});
