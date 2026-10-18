import { applyImmutable } from "@earendil-works/chord/delta";
import type { ConversationView, LiveState } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import {
  type FauxWorld,
  isRunning,
  openFauxWorld,
  setUpConversation,
  trackView,
  waitUntil,
} from "./test-support/faux-core";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();

const bigText = (tag: string) => `${tag} ${"lorem ipsum ".repeat(3500)}`;

type Entry = ConversationView["entries"][number];
type Compaction = NonNullable<LiveState["compactions"]>[number];

const liveOf = (view: ConversationView | null) => view?.docs["pi.live"] as LiveState | undefined;
const compactionsOf = (view: ConversationView | null) => liveOf(view)?.compactions ?? [];
const summaryOf = (view: ConversationView | null) =>
  view?.entries.find((entry) => entry.kind === "pi.compaction");
const answers = (view: ConversationView | null) =>
  view?.entries.filter((entry) => entry.kind === "pi.assistant") ?? [];

async function watchLiveCompactions(world: FauxWorld, conversationId: string) {
  const seen: Compaction[] = [];
  let view: ConversationView | null | undefined;
  const watcher = await world.core.conversations.watch(conversationId, async (ops) => {
    view = applyImmutable<ConversationView | null>(view, ops);
    for (const compaction of compactionsOf(view ?? null)) seen.push(structuredClone(compaction));
  });
  await waitUntil(() => view !== undefined, "the first frame");
  return { seen, view: () => view ?? null, stop: () => watcher.stop() };
}

async function sendAndSettle(world: FauxWorld, conversationId: string, text: string, requestId: string) {
  const watched = await watchLiveCompactions(world, conversationId);
  await world.core.conversations.send(conversationId, { text, requestId });
  await waitUntil(() => isRunning(watched.view()), "the run to start");
  await waitUntil(() => !isRunning(watched.view()), "the run to end");
  await watched.stop();
  return watched;
}

async function conversationWithTwoBigTurns(world: FauxWorld) {
  const { conversation } = await setUpConversation(world, bigText("one"));
  await sendAndSettle(world, conversation.id, bigText("two"), "two");
  return conversation;
}

describe("what the ConversationView carries about context", () => {
  it("shows the summary entry, the usage and the live compaction of a threshold compaction", async () => {
    const world = await openFauxWorld(await tempDir());
    const conversation = await conversationWithTwoBigTurns(world);
    const third = await sendAndSettle(world, conversation.id, bigText("three"), "three");
    const view = third.view();

    const summary = summaryOf(view) as Entry & { head: number; data: { reason: string } };
    expect(summary).toMatchObject({
      kind: "pi.compaction",
      head: expect.any(Number),
      data: { reason: "threshold" },
    });
    expect(summary.model?.[0]).toMatchObject({ role: "user" });
    const firstKept = view?.entries[view.entries.findIndex((entry) => entry.id === summary.id) + 1];
    expect(firstKept?.id).toBe(summary.head);

    const lastAnswer = answers(view).at(-1)?.model?.[0] as unknown as { usage: Record<string, number> };
    expect(lastAnswer.usage).toMatchObject({
      input: expect.any(Number),
      output: expect.any(Number),
      cacheRead: expect.any(Number),
      cacheWrite: expect.any(Number),
      totalTokens: expect.any(Number),
    });
    expect(lastAnswer.usage.totalTokens).toBeGreaterThan(0);

    expect(third.seen).toContainEqual({
      taskId: expect.any(Number),
      reason: "threshold",
      blocking: true,
      attempt: 1,
    });
    expect(compactionsOf(view)).toEqual([]);
    await world.core.close();
  });

  it("shows a manual compaction the same way, and finishes with the summary in the view", async () => {
    const world = await openFauxWorld(await tempDir());
    const conversation = await conversationWithTwoBigTurns(world);
    const watched = await watchLiveCompactions(world, conversation.id);
    await world.core.conversations.compact(conversation.id, { instructions: "keep it short" });
    await waitUntil(() => summaryOf(watched.view()) !== undefined, "the summary entry");
    expect(summaryOf(watched.view())).toMatchObject({ kind: "pi.compaction", data: { reason: "manual" } });
    expect(watched.seen).toContainEqual({
      taskId: expect.any(Number),
      reason: "manual",
      blocking: false,
      attempt: 1,
    });
    await watched.stop();
    await world.core.close();
  });
});

describe("how a manual compaction ends", () => {
  it("has nothing to compact in a short thread", async () => {
    const world = await openFauxWorld(await tempDir());
    const { conversation } = await setUpConversation(world, "short");
    await expect(world.core.conversations.compact(conversation.id, {})).rejects.toMatchObject({
      code: "nothing_to_compact",
    });
    const tracker = await trackView(world.core, conversation.id);
    expect(summaryOf(tracker.view())).toBeUndefined();
    await tracker.stop();
    await world.core.close();
  });

  it("reports the summarizer's failure as internal with its message", async () => {
    const world = await openFauxWorld(await tempDir());
    const conversation = await conversationWithTwoBigTurns(world);
    await expect(
      world.core.conversations.compact(conversation.id, { instructions: "fail" }),
    ).rejects.toMatchObject({
      code: "internal",
      message: expect.stringContaining("Simulated provider failure"),
    });
    const tracker = await trackView(world.core, conversation.id);
    expect(liveOf(tracker.view())?.compactionFailure).toMatchObject({
      reason: "manual",
      error: expect.stringContaining("Simulated provider failure"),
    });
    await tracker.stop();
    await world.core.close();
  });

  it("rejects an unknown thread with not_found", async () => {
    const world = await openFauxWorld(await tempDir());
    await expect(world.core.conversations.compact("999", {})).rejects.toMatchObject({ code: "not_found" });
    await world.core.close();
  });
});
