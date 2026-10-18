import { afterEach, describe, expect, it } from "vitest";
import { harnessNotificationSubmitter } from "../harness/notification-submitter";
import { waitUntilTrue } from "../test-support/conversation-harness";
import { useTempDir } from "../test-support/temp-dir";
import { classifyError } from "./error-class";
import { continuation } from "./goal-rows";
import { type GoalWorld, openGoalWorld, scriptedJudge, verdictJson } from "./goal-test-support";

const tempDir = useTempDir();
let goalWorld: GoalWorld | undefined;

afterEach(async () => {
  await goalWorld?.close();
  goalWorld = undefined;
});

const open = async (answers: Parameters<typeof scriptedJudge>[0], options = {}, directory?: string) => {
  const judge = scriptedJudge(answers);
  goalWorld = await openGoalWorld(directory ?? (await tempDir()), judge.ask, options);
  return { ...goalWorld, judge };
};

const advanceWhenArmed = async (world: GoalWorld, ms: number) => {
  await waitUntilTrue(async () => world.clock.pending() > 0, "a scheduled run");
  world.clock.advance(ms);
};

describe("goal: error classes", () => {
  it.each([
    ["401 Unauthorized", "clear"],
    ["Your credit balance is too low", "clear"],
    ["No such model: gpt-9", "clear"],
    ["prompt is too long: context length exceeded", "clear"],
    ["429 rate limit reached", "pause"],
    ["You hit your usage limit", "pause"],
    ["503 the model is overloaded", "retry"],
    ["ECONNRESET: connection dropped", "retry"],
  ] as const)("%s is %s", (message, expected) => {
    expect(classifyError(message)).toBe(expected);
  });

  it("a judge auth error clears the goal with a notice", async () => {
    const { startThread, service, entriesOfKind } = await open([new Error("401 Unauthorized")]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    await waitUntilTrue(async () => (await service.get(id)) === null, "a cleared goal");
    expect(await entriesOfKind(id, "app.notice")).toHaveLength(1);
  });

  it("a judge rate limit pauses the goal", async () => {
    const { startThread, service, waitForGoal } = await open([new Error("429 rate limit")]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    await waitForGoal(id, "paused", (goal) => goal.state === "paused");
  });

  it("a transient judge error retries 3 times with backoff, then pauses", async () => {
    const { startThread, service, judge, waitForGoal, ...world } = await open([new Error("503 overloaded")]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    for (let retry = 1; retry <= 3; retry++) {
      await waitUntilTrue(async () => judge.calls.length === retry, `judge call ${retry}`);
      await advanceWhenArmed(goalWorld as GoalWorld, 10);
    }
    await waitForGoal(id, "paused", (goal) => goal.state === "paused");
    expect(judge.calls).toHaveLength(4);
    void world;
  });

  it("a run error is retried through the backoff, then judged", async () => {
    const { startThread, service, judge, ...world } = await open([verdictJson("met")]);
    const id = await startThread();
    await service.set(id, "fail");
    await advanceWhenArmed(goalWorld as GoalWorld, 10);
    await waitUntilTrue(async () => judge.calls.length === 1, "the judge after the retry");
    void world;
  });
});

describe("goal: check-ins", () => {
  it("sends at most 3 idle check-ins at 30 minutes, 1 hour and 2 hours, and a user message resets them", async () => {
    const { startThread, service, judge, entriesOfKind, ...world } = await open([verdictJson("met")], {
      checkinMinutes: 30,
    });
    const test = goalWorld as GoalWorld;
    test.live = true;
    const id = await startThread();
    await service.set(id, "all tests pass");
    const minutes = (count: number) => count * 60_000;
    for (const [index, wait] of [30, 60, 120].entries()) {
      await advanceWhenArmed(test, minutes(wait));
      await waitUntilTrue(
        async () => (await entriesOfKind(id, "app.notice")).length === index + 1,
        "a check-in",
      );
      await waitUntilTrue(async () => (await service.get(id))?.state === "active", "an active goal");
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(test.clock.pending()).toBe(0);
    expect(await entriesOfKind(id, "app.notice")).toHaveLength(3);
    expect(judge.calls).toHaveLength(0);
    await world.world.store.send(id, { text: "status?", requestId: "status" }, Date.now());
    await waitUntilTrue(async () => test.clock.pending() > 0, "a new check-in after the user's message");
  });

  it("TAU_GOAL_CHECKIN_MINUTES=0 turns check-ins off", async () => {
    const { startThread, service, ...world } = await open([verdictJson("met")], { checkinMinutes: 0 });
    const test = goalWorld as GoalWorld;
    test.live = true;
    const id = await startThread();
    await service.set(id, "all tests pass");
    await world.waitForIdle(id);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(test.clock.pending()).toBe(0);
  });
});

describe("goal: restart", () => {
  it("keeps the goal and its counters", async () => {
    const directory = await tempDir();
    const first = await open(
      [verdictJson("not_met", "keep going"), new Error("429 rate limit")],
      {},
      directory,
    );
    const id = await first.startThread();
    await first.service.set(id, "all tests pass");
    await first.waitForGoal(id, "paused", (goal) => goal.state === "paused");
    const before = await first.service.get(id);
    await first.close();
    goalWorld = undefined;
    const second = await open([verdictJson("met")], {}, directory);
    expect(await second.service.get(id)).toEqual(before);
    expect(before).toMatchObject({
      condition: "all tests pass",
      turnsEvaluated: 1,
      lastReason: "keep going",
    });
  });

  it("judges again a goal that was judging, with one continuation only", async () => {
    const directory = await tempDir();
    const hang = scriptedJudge([() => new Promise<string>(() => undefined)]);
    goalWorld = await openGoalWorld(directory, hang.ask);
    const id = await goalWorld.startThread();
    await goalWorld.service.set(id, "all tests pass");
    await waitUntilTrue(async () => hang.calls.length === 1, "the judge call");
    await goalWorld.world.close();
    goalWorld = undefined;

    const second = await open([verdictJson("not_met", "after restart"), verdictJson("met")], {}, directory);
    await second.service.recoverAtStartup();
    await second.waitForGoal(id, "achieved", (goal) => goal.state === "achieved");
    const continuations = (await second.entriesOfKind(id, "app.goal_verdict")) as {
      data: { reason: string };
    }[];
    expect(continuations.map((row) => row.data.reason)).toEqual(["after restart", "because"]);
  });

  it("the requestId dedupes a continuation", async () => {
    const { startThread, world } = await open([verdictJson("met")]);
    const id = await startThread();
    const data = { goalId: "g1", verdict: "not_met" as const, reason: "more", turnsEvaluated: 1 };
    const notifications = harnessNotificationSubmitter(world.harness);
    await notifications.notify(id, continuation(data, "all tests pass"));
    await notifications.notify(id, continuation(data, "all tests pass"));
    await waitUntilTrue(
      async () => (await goalWorld?.entriesOfKind(id, "app.goal_verdict"))?.length === 1,
      "one row",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await goalWorld?.entriesOfKind(id, "app.goal_verdict")).toHaveLength(1);
  });
});
