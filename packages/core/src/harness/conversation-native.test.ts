import { afterEach, describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { legacyWorkspace, readMeta } from "./conversation-index";
import {
  createNativeConversation,
  isNativeConversation,
  listNativeConversations,
  type NativeStartRequest,
  recordNativeActivity,
  touchNativeConversation,
} from "./conversation-native";
import { createConversationStore } from "./conversation-store";
import { BACKGROUND } from "./open";
import { createRuntimeStore } from "./runtime-store";
import { modelCallsOf, openRuntimeWorld, type RuntimeWorld } from "./runtime-store-fixture";

const tempDir = useTempDir();
const open: RuntimeWorld[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((world) => world.close().catch(() => undefined)));
});

async function openWorld(directory: string, previous?: RuntimeWorld): Promise<RuntimeWorld> {
  const world = await openRuntimeWorld(directory, previous?.setup);
  open.push(world);
  return world;
}

const requestIn = (
  directory: string,
  requestId = "start-1",
  text = "Explain the build",
): NativeStartRequest => ({
  project: { id: "p1", path: directory },
  input: { text, requestId },
  workspace: legacyWorkspace(directory),
  now: 1_000,
});

const storeOf = (world: RuntimeWorld) => createConversationStore(world.harness, async () => world.directory);

async function submissionCount(world: RuntimeWorld): Promise<number> {
  return (await world.harness.inspect(BACKGROUND)).submissions.length;
}

describe("a native conversation container", () => {
  it("lists as a normal sidebar thread marked claude-code, with no model", async () => {
    const world = await openWorld(await tempDir());
    const { summary, created } = await createNativeConversation(world.harness, requestIn(world.directory));

    expect(created).toBe(true);
    expect(summary).toMatchObject({
      projectId: "p1",
      title: "Explain the build",
      createdAt: 1_000,
      updatedAt: 1_000,
      archivedAt: null,
      status: "idle",
      lastRunEndedAt: null,
      model: null,
      executor: "claude-code",
      workspace: { mode: "checkout", path: world.directory },
      parentId: null,
    });
    const store = storeOf(world);
    expect(await store.list("p1")).toEqual([summary]);
    expect(await store.find(summary.id)).toEqual(summary);
    expect(await store.modelOf(summary.id)).toBeUndefined();
  });

  it("never gives Pi a first input, a model, a submission or a model call", async () => {
    const world = await openWorld(await tempDir());
    const { summary } = await createNativeConversation(world.harness, requestIn(world.directory));

    const meta = await readMeta(world.harness, Number(summary.id) as never);
    expect(meta).toMatchObject({ projectId: "p1", titleSource: "first-message", executor: "claude-code" });
    expect(meta?.pendingFirstInput).toBeUndefined();
    expect(await submissionCount(world)).toBe(0);
    expect(await storeOf(world).resumePendingStarts()).toEqual([]);
    expect(modelCallsOf(world.setup)).toBe(0);
    const inspection = await createRuntimeStore(world.harness, summary.id).operationState();
    expect(inspection.lifecycle).toBeUndefined();
  });

  it("is idempotent by request id", async () => {
    const world = await openWorld(await tempDir());
    const first = await createNativeConversation(world.harness, requestIn(world.directory));
    const again = await createNativeConversation(world.harness, requestIn(world.directory));
    const other = await createNativeConversation(world.harness, requestIn(world.directory, "start-2"));

    expect(again.created).toBe(false);
    expect(again.summary).toEqual(first.summary);
    expect(other.summary.id).not.toBe(first.summary.id);
    expect(await storeOf(world).list("p1")).toHaveLength(2);
    expect(await listNativeConversations(world.harness)).toHaveLength(2);
  });

  it("is recognised as native, and a bare Pi container is not", async () => {
    const world = await openWorld(await tempDir());
    const { summary } = await createNativeConversation(world.harness, requestIn(world.directory));

    expect(await isNativeConversation(world.harness, summary.id)).toBe(true);
    expect(await isNativeConversation(world.harness, "999")).toBe(false);
    expect(await isNativeConversation(world.harness, "not-a-number")).toBe(false);
  });

  it("survives a restart as the same marked thread without any Pi work", async () => {
    const directory = await tempDir();
    const first = await openWorld(directory);
    const { summary } = await createNativeConversation(first.harness, requestIn(directory));
    await first.close();

    const second = await openWorld(directory, first);
    expect(await storeOf(second).find(summary.id)).toEqual(summary);
    expect(await isNativeConversation(second.harness, summary.id)).toBe(true);
    expect(await listNativeConversations(second.harness)).toEqual([{ id: summary.id, projectId: "p1" }]);
    expect(await storeOf(second).resumePendingStarts()).toEqual([]);
    expect(await submissionCount(second)).toBe(0);
    expect(modelCallsOf(second.setup)).toBe(0);
    const repeated = await createNativeConversation(second.harness, requestIn(directory));
    expect(repeated).toEqual({ summary, created: false });
  });

  it("mirrors a run on the sidebar entry and unarchives only on a new message", async () => {
    const world = await openWorld(await tempDir());
    const { summary } = await createNativeConversation(world.harness, requestIn(world.directory));
    const thread = { id: summary.id, projectId: "p1" };
    const store = storeOf(world);

    await recordNativeActivity(world.harness, thread, { status: "running", at: 2_000, endedRun: false });
    expect(await store.find(summary.id)).toMatchObject({ status: "running", updatedAt: 2_000 });

    await store.archive(summary.id, true, 2_500);
    await recordNativeActivity(world.harness, thread, { status: "idle", at: 3_000, endedRun: true });
    expect(await store.find(summary.id)).toMatchObject({
      status: "idle",
      lastRunEndedAt: 3_000,
      archivedAt: 2_500,
    });

    await touchNativeConversation(world.harness, thread, 4_000);
    expect(await store.find(summary.id)).toMatchObject({ archivedAt: null, updatedAt: 4_000 });
  });

  it("applies no activity to a deleted thread", async () => {
    const world = await openWorld(await tempDir());
    const { summary } = await createNativeConversation(world.harness, requestIn(world.directory));
    await storeOf(world).remove(summary.id, 5_000);

    const applied = await recordNativeActivity(
      world.harness,
      { id: summary.id, projectId: "p1" },
      { status: "running", at: 6_000, endedRun: false },
    );

    expect(applied).toBe(false);
    expect(await isNativeConversation(world.harness, summary.id)).toBe(false);
  });
});
