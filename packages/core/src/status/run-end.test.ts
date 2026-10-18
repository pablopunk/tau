import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunEnd } from "../harness/run-end";
import {
  type ConversationHarness,
  openConversationHarness,
  startRequest,
  waitUntilTrue,
} from "../test-support/conversation-harness";
import { useTempDir } from "../test-support/temp-dir";

const tempDir = useTempDir();
let world: ConversationHarness;
let ends: RunEnd[];

beforeEach(async () => {
  world = await openConversationHarness(await tempDir());
  ends = [];
  world.status.onRunEnded(async (end) => {
    ends.push(end);
  });
});

afterEach(() => world.close());

const endOf = async (id: string) => {
  await waitUntilTrue(async () => ends.some((end) => end.conversationId === id), "the run end");
  return ends.find((end) => end.conversationId === id) as RunEnd;
};

describe("StatusTracker.onRunEnded", () => {
  it("reports ok for a normal answer, with the first entry of the run", async () => {
    const { summary } = await world.store.start(startRequest(world, "hello", "ok"));
    const end = await endOf(summary.id);
    expect(end).toMatchObject({ conversationId: summary.id, outcome: "ok" });
    expect(end.runStartEntryId).toEqual(expect.any(String));
  });

  it("reports error for a failed answer", async () => {
    const { summary } = await world.store.start(startRequest(world, "fail", "error"));
    expect((await endOf(summary.id)).outcome).toBe("error");
  });

  it("pin: a user Stop is aborted", async () => {
    const { summary } = await world.store.start(startRequest(world, "bash sleep 30", "stopped"));
    await waitUntilTrue(
      async () => (await world.store.list(world.project.id)).some((item) => item.status === "running"),
      "the run",
    );
    await world.store.abort(summary.id);
    expect((await endOf(summary.id)).outcome).toBe("aborted");
  });

  it("starts the second run after the first final answer", async () => {
    const { summary } = await world.store.start(startRequest(world, "hello", "first"));
    const first = await endOf(summary.id);
    await world.store.send(summary.id, { text: "hello again", requestId: "second" }, Date.now());
    await waitUntilTrue(async () => ends.length === 2, "the second run end");
    expect(ends[1]?.runStartEntryId).not.toBe(first.runStartEntryId);
  });
});
