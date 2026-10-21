import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import type { Harness } from "@earendil-works/pi-durable";
import type { Change, Project } from "@tau/protocol";
import { type ChangeEmitter, createChangeEmitter } from "../change-emitter";
import { createConversationRecovery } from "../conversation-recovery";
import { legacyWorkspace } from "../harness/conversation-index";
import { type ConversationStore, createConversationStore } from "../harness/conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "../harness/open";
import { createAgentRegistry } from "../harness/registry";
import { createStatusTracker, type StatusTracker } from "../status/status-tracker";
import { createFauxSetup } from "../testing/faux-provider";
import { createUploadStore, type UploadStore } from "../upload-store";
import { processToolServices } from "./process-tool-services";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const FAUX_MODEL = { provider: "faux", modelId: "faux-1" };

/** Models that load after the Harness opens, like Claude CLI: `before` loads them ahead of `resume()`, as `createCore` does. */
export type LateModels = { readonly before: boolean; readonly afterMs: number };

export interface ConversationHarness {
  readonly harness: Harness;
  readonly uploads: UploadStore;
  readonly store: ConversationStore;
  readonly changes: ChangeEmitter;
  readonly seen: Change[];
  readonly status: StatusTracker;
  readonly project: Project;
  readonly models: ReturnType<typeof createFauxSetup>["models"];
  /** The startup steps of `createCore` that belong to conversations, in their order. */
  recover(): Promise<void>;
  close(): Promise<void>;
}

export async function openConversationHarness(
  directory: string,
  options: { tokensPerSecond?: number; now?: () => number; modelsLoad?: LateModels } = {},
): Promise<ConversationHarness> {
  const now = options.now ?? Date.now;
  const setup = createFauxSetup({ tokensPerSecond: options.tokensPerSecond });
  const late = options.modelsLoad;
  const models = late ? createModels() : setup.models;
  const changes = createChangeEmitter();
  const seen: Change[] = [];
  changes.subscribe((change) => seen.push(change));
  const status = createStatusTracker({ changes, now });
  const harness = await openAgentHarness({
    storage: await openSqliteStorage(join(directory, "agent.sqlite")),
    models,
    registry: createAgentRegistry(processToolServices(directory)),
    beforeResume: async (opened) => {
      status.attach(opened);
      if (late?.before) await sleep(late.afterMs).then(() => models.setProvider(setup.faux.provider));
    },
  });
  if (late && !late.before) void sleep(late.afterMs).then(() => models.setProvider(setup.faux.provider));
  const uploads = createUploadStore({ now, root: join(directory, "uploads") });
  const store = createConversationStore(harness, async () => directory, { uploads });
  const recovery = createConversationRecovery({ harness, conversations: store, changes });
  const project: Project = {
    id: "p1",
    name: "main",
    path: directory,
    createdAt: 0,
    kind: "folder",
    status: "ready",
    isGitRepo: false,
  };
  return {
    harness,
    uploads,
    store,
    changes,
    seen,
    status,
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
  workspace: legacyWorkspace(world.project.path),
  now: Date.now(),
});

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
