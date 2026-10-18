import type { Harness } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitUntilTrue } from "../test-support/conversation-harness";
import { useTempDir } from "../test-support/temp-dir";
import { createGoalService } from "./goal-service";
import { type GoalWorld, openGoalWorld, scriptedJudge, verdictJson } from "./goal-test-support";

const tempDir = useTempDir();
let goalWorld: GoalWorld | undefined;

afterEach(async () => {
  await goalWorld?.close();
  goalWorld = undefined;
});

const open = async (answers: Parameters<typeof scriptedJudge>[0], options = {}) => {
  const judge = scriptedJudge(answers);
  goalWorld = await openGoalWorld(await tempDir(), judge.ask, options);
  return { ...goalWorld, judge, world: goalWorld.world };
};

describe("goal: set, get and the judge loop", () => {
  it("set starts a turn now with the condition, and shows an active goal", async () => {
    const { startThread, service, judge, waitForGoal } = await open([verdictJson("not_met")]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    expect(await service.get(id)).toMatchObject({ condition: "all tests pass", state: "active" });
    await waitForGoal(id, "the first verdict", (goal) => goal.turnsEvaluated >= 1);
    expect(judge.calls[0]).toContain("all tests pass");
  });

  it("not_met continues with the reason; met stops and records the state", async () => {
    const { startThread, service, entriesOfKind, waitForGoal } = await open([
      verdictJson("not_met", "tests still fail"),
      verdictJson("met", "tests pass"),
    ]);
    const id = await startThread();
    await service.set(id, "bash echo hi");
    await waitForGoal(id, "achieved", (goal) => goal.state === "achieved");
    expect(await service.get(id)).toMatchObject({
      turnsEvaluated: 2,
      lastVerdict: "met",
      lastReason: "tests pass",
    });
    const rows = (await entriesOfKind(id, "app.goal_verdict")) as { data: { reason: string } }[];
    expect(rows.map((row) => row.data.reason)).toEqual(["tests still fail", "tests pass"]);
  });

  it("impossible stops and records a failed goal", async () => {
    const { startThread, service, waitForGoal } = await open([verdictJson("impossible", "needs a server")]);
    const id = await startThread();
    await service.set(id, "bash echo hi");
    await waitForGoal(id, "failed", (goal) => goal.state === "failed");
    expect(await service.get(id)).toMatchObject({ lastVerdict: "impossible", lastReason: "needs a server" });
  });

  it("set while busy queues the directive as a follow-up", async () => {
    const { startThread, service, world, entryKinds, waitForGoal, waitForIdle } = await open(
      [verdictJson("met")],
      { tokensPerSecond: 40 },
    );
    const id = await startThread();
    await world.store.send(id, { text: "hello again", requestId: "again" }, Date.now(), "followUp");
    await service.set(id, "all tests pass");
    await waitForGoal(id, "achieved", (goal) => goal.state === "achieved");
    await waitForIdle(id);
    const kinds = await entryKinds(id);
    expect(kinds.filter((kind) => kind === "pi.user")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "pi.assistant")).toHaveLength(3);
  });

  it("a user Stop pauses the goal and does not continue", async () => {
    const { startThread, service, world, judge, waitForGoal } = await open([verdictJson("not_met")]);
    const id = await startThread();
    await service.set(id, "bash sleep 30");
    await waitUntilTrue(async () => (await world.store.find(id))?.status === "running", "the run");
    await world.store.abort(id);
    await waitForGoal(id, "paused", (goal) => goal.state === "paused");
    expect(judge.calls).toHaveLength(0);
  });

  it("a user message resumes a paused goal", async () => {
    const { startThread, service, world, waitForGoal } = await open([verdictJson("met")]);
    const id = await startThread();
    await service.set(id, "bash sleep 30");
    await waitUntilTrue(async () => (await world.store.find(id))?.status === "running", "the run");
    await world.store.abort(id);
    await waitForGoal(id, "paused", (goal) => goal.state === "paused");
    await world.store.send(id, { text: "carry on", requestId: "carry" }, Date.now());
    await waitForGoal(id, "achieved", (goal) => goal.state === "achieved");
  });

  it("a message after a Stop resumes the goal and the next run end is judged", async () => {
    const { startThread, service, world, judge, waitForGoal } = await open([verdictJson("met")]);
    const id = await startThread();
    await service.set(id, "bash sleep 30");
    await waitUntilTrue(async () => (await world.store.find(id))?.status === "running", "the run");
    await world.store.abort(id);
    await waitForGoal(id, "paused", (goal) => goal.state === "paused");
    await world.store.send(id, { text: "Continue with the goal.", requestId: "continue" }, Date.now());
    await waitForGoal(id, "achieved", (goal) => goal.state === "achieved");
    expect(judge.calls).toHaveLength(1);
  });

  it("a message does not resume an achieved goal", async () => {
    const { startThread, service, world, judge, waitForGoal, waitForIdle } = await open([verdictJson("met")]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    await waitForGoal(id, "achieved", (goal) => goal.state === "achieved");
    await waitForIdle(id);
    await world.store.send(id, { text: "thanks", requestId: "thanks" }, Date.now());
    await waitForIdle(id);
    expect(await service.get(id)).toMatchObject({ state: "achieved" });
    expect(judge.calls).toHaveLength(1);
  });

  it("a stale verdict is dropped when the user sends a message during the judge call", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { startThread, service, world, entriesOfKind, waitForGoal, judge } = await open([
      async () => {
        await gate;
        return verdictJson("not_met", "from the first judge");
      },
      verdictJson("met", "from the second judge"),
    ]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    await waitUntilTrue(async () => judge.calls.length === 1, "the first judge call");
    await world.store.send(id, { text: "hello again", requestId: "again" }, Date.now());
    await waitForGoal(id, "achieved", (goal) => goal.state === "achieved");
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const reasons = ((await entriesOfKind(id, "app.goal_verdict")) as { data: { reason: string } }[]).map(
      (row) => row.data.reason,
    );
    expect(reasons).toEqual(["from the second judge"]);
    expect(await service.get(id)).toMatchObject({ state: "achieved", turnsEvaluated: 1 });
  });

  it("a run with a running subagent skips the judge", async () => {
    const { startThread, service, judge, waitForIdle, world } = await open([verdictJson("met")]);
    const world2 = goalWorld;
    if (world2) world2.live = true;
    const id = await startThread();
    await service.set(id, "all tests pass");
    await waitUntilTrue(async () => (await world.store.find(id))?.lastRunEndedAt !== null, "a run end");
    await waitForIdle(id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(judge.calls).toHaveLength(0);
    expect(await service.get(id)).toMatchObject({ state: "active", turnsEvaluated: 0 });
  });

  it("3 runs in a row with no tool use pause the goal", async () => {
    const { startThread, service, judge, entriesOfKind, waitForGoal } = await open([verdictJson("not_met")]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    await waitForGoal(id, "paused", (goal) => goal.state === "paused");
    expect(judge.calls).toHaveLength(3);
    expect(await entriesOfKind(id, "app.goal_verdict")).toHaveLength(3);
    expect(await service.get(id)).toMatchObject({ state: "paused", turnsEvaluated: 3 });
  });

  it("a run that uses a tool resets the no-tool count", async () => {
    const { startThread, service, judge, waitForGoal } = await open([
      verdictJson("not_met"),
      verdictJson("not_met"),
      verdictJson("met"),
    ]);
    const id = await startThread();
    await service.set(id, "bash echo hi");
    await waitForGoal(id, "achieved", (goal) => goal.state === "achieved");
    expect(judge.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("a malformed judge answer gets one retry, then the goal pauses", async () => {
    const { startThread, service, judge, waitForGoal } = await open(["not json", "still not json"]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    await waitForGoal(id, "paused", (goal) => goal.state === "paused");
    expect(judge.calls).toHaveLength(2);
  });

  it("one malformed answer followed by a good one carries on", async () => {
    const { startThread, service, judge, waitForGoal } = await open(["oops", verdictJson("met")]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    await waitForGoal(id, "achieved", (goal) => goal.state === "achieved");
    expect(judge.calls).toHaveLength(2);
  });

  it("clear removes the goal, is idempotent, and drops a verdict in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { startThread, service, entriesOfKind, judge } = await open([
      async () => {
        await gate;
        return verdictJson("met");
      },
    ]);
    const id = await startThread();
    await service.set(id, "all tests pass");
    await waitUntilTrue(async () => judge.calls.length === 1, "the judge call");
    await service.clear(id);
    await service.clear(id);
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await service.get(id)).toBeNull();
    expect(await entriesOfKind(id, "app.goal_verdict")).toHaveLength(0);
  });

  it("an unknown thread is not found", async () => {
    const { service } = await open([verdictJson("met")]);
    await expect(service.get("98765")).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects an empty condition", async () => {
    const { startThread, service } = await open([verdictJson("met")]);
    const id = await startThread();
    await expect(service.set(id, "   ")).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("goal: subagents", () => {
  it("a subagent cannot set a goal", async () => {
    const service = createGoalService({
      harness: {} as Harness,
      conversations: { find: async () => ({ parentId: "7" }) as never },
      notifications: { notify: async () => undefined },
      scheduler: { scheduleAt: () => undefined, cancel: () => undefined, close: async () => undefined },
      liveWork: { hasLiveWork: async () => false },
      ask: async () => ({ text: "", tokens: 0 }),
      changes: { emit: () => undefined } as never,
      now: Date.now,
      checkinMinutes: 0,
    });
    await expect(service.set("8", "all tests pass")).rejects.toMatchObject({ code: "invalid_request" });
  });
});
