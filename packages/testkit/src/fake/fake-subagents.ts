import { SUBAGENT_NOTIFICATION_KIND, type SubagentNotificationData } from "@tau/protocol";
import type { FakeConversation } from "./fake-conversation";
import type { Mvp5Context } from "./fake-mvp5";

const POLL_MS = 20;
const HELD_MARKER = "sleep";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => boolean): Promise<void> {
  while (!condition()) await sleep(POLL_MS);
}

function notify(parent: FakeConversation, child: FakeConversation, data: SubagentNotificationData): void {
  child.setAgentStatus(data.status);
  void waitUntil(() => !parent.isBusy()).then(() => parent.appendEntry(SUBAGENT_NOTIFICATION_KIND, data));
}

export function reportStopped(child: FakeConversation, require: (id: string) => FakeConversation): void {
  if (child.parentId === null || child.agentInfo?.status !== "running") return;
  notify(require(child.parentId), child, {
    childId: child.id,
    status: "stopped",
    title: child.title,
    report: "Stopped.",
  });
}

async function runChild(parent: FakeConversation, child: FakeConversation, description: string, n: number) {
  child.send(`subagent-${n}`, { text: description });
  await waitUntil(() => !child.isBusy());
  if (child.agentInfo?.status !== "running") return;
  notify(parent, child, {
    childId: child.id,
    status: "done",
    title: description,
    report: `Done: ${description}`,
  });
}

export function startFakeAgent(
  ctx: Mvp5Context,
  parent: FakeConversation,
  description: string,
  n: number,
): void {
  const child = ctx.spawn({ source: parent, title: description, forkOf: null, parentId: parent.id });
  child.agentInfo = { type: "general-purpose", model: parent.model, status: "running" };
  if (!description.includes(HELD_MARKER)) void runChild(parent, child, description, n);
}
