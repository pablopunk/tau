import {
  AppError,
  type Change,
  type ConversationSummary,
  type Core,
  GOAL_CONDITION_MAX_LENGTH,
  type Goal,
  type Timer,
} from "@tau/protocol";
import type { FakeConversation } from "./fake-conversation";

export const DYNAMIC_LOOP_INSTRUCTION =
  "At the end of each turn, call `schedule_wakeup` with the delay that fits (at least 5 min unless the user asked for less), or stop by not calling it.";

const MINUTE_MS = 60_000;
const UNIT_MS = { m: MINUTE_MS, h: 60 * MINUTE_MS, d: 24 * 60 * MINUTE_MS } as const;

export interface Mvp8Context {
  readonly emit: (change: Change) => void;
  readonly now: () => number;
  readonly requireConversation: (id: string) => FakeConversation;
}

type SummaryExtras = Pick<ConversationSummary, "timers" | "nextTimerAt" | "goal">;

export function parseEvery(every: string): number {
  const match = /^(\d+)([mhd])$/.exec(every.trim());
  const ms = match ? Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS] : 0;
  if (ms < MINUTE_MS) throw new AppError("invalid_request", `"${every}" is not an interval of 1m or more.`);
  return ms;
}

/** An in-memory stand-in: timers never fire. The fake shows state, the real core owns the behavior. */
export function createFakeMvp8(ctx: Mvp8Context) {
  const timers = new Map<string, Timer[]>();
  const goals = new Map<string, Goal>();
  let nextId = 1;

  const announce = (conversation: FakeConversation) =>
    ctx.emit({ resource: "conversations", projectId: conversation.projectId });
  const announceTimers = (conversationId: string) => ctx.emit({ resource: "timers", conversationId });
  const timersOf = (conversationId: string) => timers.get(conversationId) ?? [];

  function extras(conversationId: string): SummaryExtras {
    const list = timersOf(conversationId);
    const next = Math.min(...list.map((timer) => timer.nextAt));
    const goal = goals.get(conversationId);
    return {
      timers: list.length,
      nextTimerAt: list.length === 0 ? null : new Date(next).toISOString(),
      goal: goal ? { state: goal.state, condition: goal.condition } : null,
    };
  }

  function addLoopTimer(conversationId: string, every: string, prompt: string): Timer {
    const now = ctx.now();
    const timer: Timer = {
      id: `timer-${nextId++}`,
      conversationId,
      kind: "repeat",
      every,
      prompt,
      reason: null,
      source: "loop",
      createdAt: now,
      expiresAt: now + 7 * UNIT_MS.d,
      nextAt: now + parseEvery(every),
      firedCount: 0,
    };
    timers.set(conversationId, [...timersOf(conversationId), timer]);
    return timer;
  }

  const api: Pick<Core, "timers" | "goals"> = {
    timers: {
      async list(conversationId) {
        ctx.requireConversation(conversationId);
        return timersOf(conversationId).map((timer) => ({ ...timer }));
      },
      async delete(id) {
        for (const [conversationId, list] of timers) {
          if (!list.some((timer) => timer.id === id)) continue;
          timers.set(
            conversationId,
            list.filter((timer) => timer.id !== id),
          );
          announceTimers(conversationId);
          announce(ctx.requireConversation(conversationId));
        }
      },
      async loop(conversationId, { every, prompt }) {
        const conversation = ctx.requireConversation(conversationId);
        if (every === undefined) {
          conversation.send(
            `loop:${nextId++}:0`,
            { text: `${prompt}\n\n${DYNAMIC_LOOP_INSTRUCTION}` },
            "followUp",
          );
          return;
        }
        const timer = addLoopTimer(conversationId, every, prompt);
        conversation.send(`loop:${timer.id}:0`, { text: prompt }, "followUp");
        announceTimers(conversationId);
        announce(conversation);
      },
      async stopLoop(conversationId) {
        const conversation = ctx.requireConversation(conversationId);
        timers.set(
          conversationId,
          timersOf(conversationId).filter((timer) => timer.source !== "loop"),
        );
        announceTimers(conversationId);
        announce(conversation);
      },
    },
    goals: {
      async set(conversationId, condition) {
        const conversation = ctx.requireConversation(conversationId);
        if (conversation.parentId !== null) {
          throw new AppError("invalid_request", "A subagent cannot have a goal.");
        }
        if (condition.trim() === "" || condition.length > GOAL_CONDITION_MAX_LENGTH) {
          throw new AppError("invalid_request", "The goal needs 1 to 4,000 characters.");
        }
        const goal: Goal = {
          id: `goal-${nextId++}`,
          condition,
          state: "active",
          startedAt: ctx.now(),
          turnsEvaluated: 0,
          tokensSpent: 0,
          lastVerdict: null,
          lastReason: null,
        };
        goals.set(conversationId, goal);
        conversation.send(`goal:${goal.id}:start`, { text: condition }, "followUp");
        announce(conversation);
      },
      async get(conversationId) {
        ctx.requireConversation(conversationId);
        const goal = goals.get(conversationId);
        return goal ? { ...goal } : null;
      },
      async clear(conversationId) {
        const conversation = ctx.requireConversation(conversationId);
        if (goals.delete(conversationId)) announce(conversation);
      },
    },
  };

  return {
    ...api,
    extras,
    release(conversationId: string): void {
      timers.delete(conversationId);
      goals.delete(conversationId);
    },
  };
}

export type FakeMvp8 = ReturnType<typeof createFakeMvp8>;
