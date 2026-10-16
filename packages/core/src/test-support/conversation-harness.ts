import { join } from "node:path";
import type { Harness } from "@earendil-works/pi-durable";
import type { Change, Project } from "@pi-everywhere/protocol";
import { type ChangeEmitter, createChangeEmitter } from "../change-emitter";
import { createConversationRecovery } from "../conversation-recovery";
import { type ConversationStore, createConversationStore } from "../harness/conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "../harness/open";
import { createStatusTracker } from "../status/status-tracker";
import { createFauxSetup } from "../testing/faux-provider";

export const FAUX_MODEL = { provider: "faux", modelId: "faux-1" };

export interface ConversationHarness {
  readonly harness: Harness;
  readonly store: ConversationStore;
  readonly changes: ChangeEmitter;
  readonly seen: Change[];
  readonly project: Project;
  readonly models: ReturnType<typeof createFauxSetup>["models"];
  /** The startup steps of `createCore` that belong to conversations, in their order. */
  recover(): Promise<void>;
  close(): Promise<void>;
}

export async function openConversationHarness(
  directory: string,
  options: { tokensPerSecond?: number; now?: () => number } = {},
): Promise<ConversationHarness> {
  const now = options.now ?? Date.now;
  const { models } = createFauxSetup({ tokensPerSecond: options.tokensPerSecond });
  const changes = createChangeEmitter();
  const seen: Change[] = [];
  changes.subscribe((change) => seen.push(change));
  const status = createStatusTracker({ changes, now });
  const harness = await openAgentHarness({
    storage: await openSqliteStorage(join(directory, "agent.sqlite")),
    models,
    beforeResume: (opened) => status.attach(opened),
  });
  const store = createConversationStore(harness);
  const recovery = createConversationRecovery({ harness, conversations: store, changes });
  const project: Project = {
    id: "p1",
    name: "main",
    path: directory,
    createdAt: 0,
    kind: "folder",
    status: "ready",
  };
  return {
    harness,
    store,
    changes,
    seen,
    project,
    models,
    async recover() {
      await status.recoverAtStartup();
      await recovery.recoverAtStartup();
    },
    close: () => harness.close(BACKGROUND),
  };
}

export const startRequest = (world: ConversationHarness, text: string, requestId: string) => ({
  project: world.project,
  model: FAUX_MODEL,
  thinkingLevel: "off" as const,
  input: { text, requestId },
  now: Date.now(),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitUntilTrue(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

export async function waitForSummary(
  world: ConversationHarness,
  id: string,
  matches: (summary: { status: string; title: string; lastRunEndedAt: number | null }) => boolean,
  what: string,
) {
  await waitUntilTrue(async () => {
    const found = (await world.store.list(world.project.id)).find((summary) => summary.id === id);
    return found !== undefined && matches(found);
  }, what);
}
