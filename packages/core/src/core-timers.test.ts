import type { ConversationView } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  answerCount,
  type FauxWorld,
  openFauxWorld,
  setUpConversation,
  trackView,
  waitForAnswerAfter,
  waitUntil,
} from "./test-support/faux-core";
import { useTempDir } from "./test-support/temp-dir";
import { DYNAMIC_LOOP_INSTRUCTION } from "./timers-api";

const tempDir = useTempDir();
let world: FauxWorld;
let root: string;

beforeEach(async () => {
  root = await tempDir();
  world = await openFauxWorld(root);
});

afterEach(() => world.core.close());

const textOf = (view: ConversationView | null) => JSON.stringify(view?.entries ?? []);

async function sendAndWait(conversationId: string, text: string, requestId: string) {
  const tracker = await trackView(world.core, conversationId);
  const before = answerCount(tracker);
  await world.core.conversations.send(conversationId, { text, requestId });
  await waitForAnswerAfter(tracker, before);
  const view = tracker.view();
  await tracker.stop();
  return view;
}

describe("timer tools", () => {
  it("schedule_wakeup and schedule_repeat make timers the thread can list and delete", async () => {
    const { conversation } = await setUpConversation(world);
    const wakeup = await sendAndWait(conversation.id, "wakeup 600 check the build", "w1");
    expect(textOf(wakeup)).toContain("Wake-up ");
    await sendAndWait(conversation.id, "repeat 5m ping", "w2");
    const timers = await world.core.timers.list(conversation.id);
    expect(timers).toMatchObject([
      { kind: "repeat", every: "5m", prompt: "ping", source: "agent", expiresAt: expect.any(Number) },
      { kind: "wakeup", every: null, prompt: "check the build", source: "agent", firedCount: 0 },
    ]);
    const listed = await sendAndWait(conversation.id, "timers", "w3");
    expect(textOf(listed)).toContain(timers[0]?.id);
    await sendAndWait(conversation.id, `timer-delete ${timers[0]?.id}`, "w4");
    expect(await world.core.timers.list(conversation.id)).toHaveLength(1);
    const foreign = await sendAndWait(conversation.id, "timer-delete nope", "w5");
    expect(textOf(foreign)).toContain("is not one of this thread's timers");
  });

  it("a repeat under one minute is a tool error and makes no timer", async () => {
    const { conversation } = await setUpConversation(world);
    const view = await sendAndWait(conversation.id, "repeat 30s too fast", "r1");
    expect(textOf(view)).toContain("at least 1m");
    expect(await world.core.timers.list(conversation.id)).toEqual([]);
  });

  it("subagents do not get the timer tools", async () => {
    const { isSubagentTool, TIMER_TOOL_NAMES } = await import("./harness/subagent-tool-names");
    expect(TIMER_TOOL_NAMES.every(isSubagentTool)).toBe(true);
  });
});

describe("/loop", () => {
  it("with an interval makes a loop timer and runs the prompt now with its own request id", async () => {
    const { conversation } = await setUpConversation(world);
    const tracker = await trackView(world.core, conversation.id);
    const before = answerCount(tracker);
    await world.core.timers.loop(conversation.id, { every: "5m", prompt: "say hi" });
    await waitForAnswerAfter(tracker, before);
    const [timer] = await world.core.timers.list(conversation.id);
    expect(timer).toMatchObject({ kind: "repeat", every: "5m", source: "loop", prompt: "say hi" });
    expect(textOf(tracker.view())).toContain("say hi");
    await tracker.stop();
  });

  it("a second /loop replaces the first loop timer but keeps the agent's timers", async () => {
    const { conversation } = await setUpConversation(world);
    await sendAndWait(conversation.id, "repeat 10m mine", "r1");
    await world.core.timers.loop(conversation.id, { every: "5m", prompt: "one" });
    await world.core.timers.loop(conversation.id, { every: "2h", prompt: "two" });
    const timers = await world.core.timers.list(conversation.id);
    expect(timers.map((timer) => [timer.source, timer.prompt])).toEqual(
      expect.arrayContaining([
        ["agent", "mine"],
        ["loop", "two"],
      ]),
    );
    expect(timers).toHaveLength(2);
  });

  it("without an interval adds the instruction to call schedule_wakeup, and makes no timer itself", async () => {
    const { conversation } = await setUpConversation(world);
    const tracker = await trackView(world.core, conversation.id);
    const before = answerCount(tracker);
    await world.core.timers.loop(conversation.id, { prompt: "watch the deploy" });
    await waitForAnswerAfter(tracker, before);
    expect(textOf(tracker.view())).toContain(DYNAMIC_LOOP_INSTRUCTION);
    expect(await world.core.timers.list(conversation.id)).toEqual([]);
    await tracker.stop();
  });

  it("rejects a bad interval and an unknown thread, and stopLoop leaves the agent's timers", async () => {
    const { conversation } = await setUpConversation(world);
    for (const every of ["30s", "5", "soon", "0m"]) {
      await expect(world.core.timers.loop(conversation.id, { every, prompt: "x" })).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
    await expect(world.core.timers.loop("98765", { prompt: "x" })).rejects.toMatchObject({
      code: "not_found",
    });
    await sendAndWait(conversation.id, "repeat 10m mine", "r1");
    await world.core.timers.loop(conversation.id, { every: "5m", prompt: "loop" });
    await world.core.timers.stopLoop(conversation.id);
    expect(await world.core.timers.list(conversation.id)).toMatchObject([{ source: "agent" }]);
  });
});

describe("timers across a restart", () => {
  const FAST = { ...process.env, TAU_TEST_TIMER_SPEED: "600" };

  it("a wake-up survives the restart and fires afterwards", async () => {
    await world.core.close();
    world = await openFauxWorld(root, Date.now, FAST);
    const { conversation } = await setUpConversation(world);
    await world.core.timers.loop(conversation.id, { every: "1h", prompt: "keep going" });
    const [timer] = await world.core.timers.list(conversation.id);
    await world.core.close();
    world = await openFauxWorld(root, Date.now, FAST);
    expect((await world.core.timers.list(conversation.id)).map((item) => item.id)).toContain(timer?.id);
    const tracker = await trackView(world.core, conversation.id);
    await waitUntil(() => textOf(tracker.view()).includes("app.timer_fired"), "the timer to fire", 30_000);
    const [fired] = await world.core.timers.list(conversation.id);
    expect(fired?.firedCount).toBeGreaterThanOrEqual(1);
    await tracker.stop();
  }, 60_000);
});
