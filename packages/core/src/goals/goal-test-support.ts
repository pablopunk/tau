import type { ConversationId } from "@earendil-works/pi-durable";
import { harnessNotificationSubmitter } from "../harness/notification-submitter";
import { BACKGROUND } from "../harness/open";
import {
  type ConversationHarness,
  openConversationHarness,
  startRequest,
  waitUntilTrue,
} from "../test-support/conversation-harness";
import { createFakeClock, type FakeClock } from "../timers/fake-clock";
import { createKeyedScheduler } from "../timers/keyed-scheduler";
import { createGoalService, type GoalService } from "./goal-service";
import type { AskJudge } from "./judge-model";

export type ScriptedAnswer = string | Error | ((call: number, user: string) => Promise<string> | string);

export const verdictJson = (verdict: "not_met" | "met" | "impossible", reason = "because") =>
  JSON.stringify({ verdict, reason });

/** A fast model that answers from a script, one answer per call; the last answer repeats. */
export function scriptedJudge(answers: ScriptedAnswer[]) {
  const calls: string[] = [];
  const ask: AskJudge = async (_conversationId, { user, signal }) => {
    const call = calls.length;
    calls.push(user);
    const next = answers[Math.min(call, answers.length - 1)] as ScriptedAnswer;
    if (next instanceof Error) throw next;
    const text = typeof next === "string" ? next : await next(call, user);
    if (signal?.aborted) throw new Error("aborted");
    return { text, tokens: 10 };
  };
  return { ask, calls };
}

export interface GoalWorld {
  readonly world: ConversationHarness;
  readonly service: GoalService;
  readonly clock: FakeClock;
  live: boolean;
  /** Starts a thread, waits for its first answer, and returns its id. */
  startThread(text?: string): Promise<string>;
  entryKinds(id: string): Promise<string[]>;
  entriesOfKind(id: string, kind: string): Promise<unknown[]>;
  waitForGoal(
    id: string,
    what: string,
    matches: (goal: NonNullable<Awaited<ReturnType<GoalService["get"]>>>) => boolean,
  ): Promise<void>;
  waitForIdle(id: string): Promise<void>;
  close(): Promise<void>;
}

export async function openGoalWorld(
  directory: string,
  ask: AskJudge,
  options: { checkinMinutes?: number; tokensPerSecond?: number; backoffMs?: number } = {},
): Promise<GoalWorld> {
  const world = await openConversationHarness(directory, { tokensPerSecond: options.tokensPerSecond });
  const clock = createFakeClock(1_000_000);
  const scheduler = createKeyedScheduler(clock);
  const state = { live: false };
  const service = createGoalService({
    harness: world.harness,
    conversations: world.store,
    notifications: harnessNotificationSubmitter(world.harness),
    scheduler,
    liveWork: { hasLiveWork: async () => state.live },
    ask,
    changes: world.changes,
    now: clock.now,
    checkinMinutes: options.checkinMinutes ?? 0,
    backoff: () => options.backoffMs ?? 10,
  });
  world.status.onRunEnded((end) => service.onRunEnded(end));
  await world.recover();

  const entriesOf = async (id: string) => {
    const conversation = await world.harness.conversation(Number(id) as ConversationId, BACKGROUND);
    return conversation ? (await conversation.context(BACKGROUND)).entries : [];
  };
  const waitForIdle = (id: string) =>
    waitUntilTrue(async () => {
      const found = await world.store.find(id);
      return found?.status === "idle" || found?.status === "error";
    }, "an idle thread");

  return {
    world,
    service,
    clock,
    get live() {
      return state.live;
    },
    set live(value: boolean) {
      state.live = value;
    },
    async startThread(text = "hello") {
      const { summary } = await world.store.start(startRequest(world, text, `start-${Math.random()}`));
      await waitUntilTrue(
        async () => (await world.store.find(summary.id))?.lastRunEndedAt != null,
        "the first run",
      );
      return summary.id;
    },
    entryKinds: async (id) => (await entriesOf(id)).map((entry) => entry.kind),
    entriesOfKind: async (id, kind) => (await entriesOf(id)).filter((entry) => entry.kind === kind),
    waitForGoal: (id, what, matches) =>
      waitUntilTrue(async () => {
        const goal = await service.get(id);
        return goal !== null && matches(goal);
      }, what),
    waitForIdle,
    async close() {
      await service.close();
      await world.close();
    },
  };
}
