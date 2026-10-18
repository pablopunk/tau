import { MONITOR_EVENT_KIND, SUBAGENT_NOTIFICATION_KIND } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConversationHarness,
  openConversationHarness,
  startRequest,
  waitUntilTrue,
} from "../test-support/conversation-harness";
import { useTempDir } from "../test-support/temp-dir";
import { harnessNotificationSubmitter, type Notification, ThreadGoneError } from "./notification-submitter";
import { BACKGROUND } from "./open";
import { subagentNotification } from "./subagent-notification";

const tempDir = useTempDir();
let directory: string;
let world: ConversationHarness;

beforeEach(async () => {
  directory = await tempDir();
  world = await openConversationHarness(directory);
});

afterEach(() => world.close());

const monitorEvent = (requestId: string): Notification => ({
  kind: MONITOR_EVENT_KIND,
  data: { processId: "p1", description: "logs", lines: ["a"], dropped: 0 },
  text: '<monitor-event id="p1">a</monitor-event>',
  requestId,
});

async function entriesOfKind(id: string, kind: string) {
  const conversation = await world.harness.conversation(Number(id) as never, BACKGROUND);
  const { entries } = (await conversation?.context(BACKGROUND)) ?? { entries: [] };
  return entries.filter((entry) => entry.kind === kind);
}

async function startIdleThread(requestId: string) {
  const { summary } = await world.store.start(startRequest(world, "hello", requestId));
  await waitUntilTrue(
    async () => (await world.store.list(world.project.id)).every((item) => item.status === "idle"),
    "an idle thread",
  );
  return summary.id;
}

describe("NotificationSubmitter", () => {
  it("adds one entry of the given kind with the model-readable text", async () => {
    const id = await startIdleThread("r1");
    await harnessNotificationSubmitter(world.harness).notify(id, monitorEvent("m1"));
    await waitUntilTrue(async () => (await entriesOfKind(id, MONITOR_EVENT_KIND)).length === 1, "the entry");
    const [entry] = await entriesOfKind(id, MONITOR_EVENT_KIND);
    expect(entry?.data).toMatchObject({ processId: "p1", lines: ["a"] });
    expect(JSON.stringify(entry?.model)).toContain("<monitor-event");
  });

  it("the same requestId is a no-op, also across a restart", async () => {
    const id = await startIdleThread("r1");
    const notify = () => harnessNotificationSubmitter(world.harness).notify(id, monitorEvent("same"));
    await notify();
    await notify();
    await waitUntilTrue(async () => (await entriesOfKind(id, MONITOR_EVENT_KIND)).length === 1, "the entry");
    await world.close();
    world = await openConversationHarness(directory);
    await world.recover();
    await notify();
    await world.status.settled();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await entriesOfKind(id, MONITOR_EVENT_KIND)).toHaveLength(1);
  });

  it("builds the subagent notification through the same path", async () => {
    const id = await startIdleThread("r1");
    const data = { childId: "9", status: "done", title: "t", report: "r" } as const;
    await harnessNotificationSubmitter(world.harness).notify(id, subagentNotification(data, "child-request"));
    await waitUntilTrue(
      async () => (await entriesOfKind(id, SUBAGENT_NOTIFICATION_KIND)).length === 1,
      "the entry",
    );
    expect(subagentNotification(data, "x").requestId).toBe("subagent-report:9:x");
  });

  it("rejects for a thread that is gone", async () => {
    await expect(
      harnessNotificationSubmitter(world.harness).notify("98765", monitorEvent("gone")),
    ).rejects.toBeInstanceOf(ThreadGoneError);
  });
});
