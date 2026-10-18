import type { ConversationId } from "@earendil-works/pi-durable";
import { harnessNotificationSubmitter, type NotificationSubmitter } from "../harness/notification-submitter";
import { BACKGROUND } from "../harness/open";
import {
  type ConversationHarness,
  openConversationHarness,
  startRequest,
  waitUntilTrue,
} from "../test-support/conversation-harness";
import { createFakeClock, type FakeClock } from "./fake-clock";
import { addTimer, type NewTimer } from "./timer-ops";
import { createTimerScheduler, type TimerScheduler } from "./timer-scheduler";
import { ProjectTimersDoc, type TimerRecord } from "./timers-doc";

export const START = 1_700_000_000_000;
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

export interface TimersWorld extends ConversationHarness {
  readonly clock: FakeClock;
  readonly announced: string[];
  makeScheduler(notifications?: NotificationSubmitter): TimerScheduler;
  startThread(text: string, requestId: string): Promise<string>;
  add(threadId: string, spec: Partial<NewTimer> & { id: string }): Promise<void>;
  timers(): Promise<readonly TimerRecord[]>;
  entriesOfKind(threadId: string, kind: string): Promise<readonly { data?: unknown }[]>;
}

export async function openTimersWorld(
  directory: string,
  options: { tokensPerSecond?: number; clock?: FakeClock } = {},
): Promise<TimersWorld> {
  const conversation = await openConversationHarness(directory, { tokensPerSecond: options.tokensPerSecond });
  const clock = options.clock ?? createFakeClock(START);
  const announced: string[] = [];
  const { harness } = conversation;
  const world: TimersWorld = {
    ...conversation,
    clock,
    announced,
    makeScheduler: (notifications = harnessNotificationSubmitter(harness)) =>
      createTimerScheduler({
        harness,
        notifications,
        clock,
        projectIds: async () => [conversation.project.id],
        announce: (_projectId, threadId) => announced.push(threadId),
      }),
    async startThread(text, requestId) {
      const { summary } = await conversation.store.start(startRequest(world, text, requestId));
      return summary.id;
    },
    async add(threadId, spec) {
      await harness.commit(
        (tx) =>
          addTimer(
            tx,
            Number(threadId) as ConversationId,
            {
              kind: "repeat",
              every: "5m",
              prompt: "check",
              reason: null,
              source: "agent",
              nextAt: clock.now() + 5 * MINUTE,
              ...spec,
            },
            clock.now(),
          ),
        BACKGROUND,
      );
    },
    async timers() {
      return (await harness.snapshot(ProjectTimersDoc, conversation.project.id, BACKGROUND))?.timers ?? [];
    },
    async entriesOfKind(threadId, kind) {
      const opened = await harness.conversation(Number(threadId) as ConversationId, BACKGROUND);
      const { entries } = (await opened?.context(BACKGROUND)) ?? { entries: [] };
      return entries.filter((entry) => entry.kind === kind);
    },
  };
  return world;
}

export async function waitUntilIdle(world: TimersWorld) {
  await waitUntilTrue(
    async () => (await world.store.list(world.project.id)).every((item) => item.status === "idle"),
    "an idle thread",
  );
}
