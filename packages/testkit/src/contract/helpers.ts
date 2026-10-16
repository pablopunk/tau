import { applyImmutable } from "@earendil-works/chord/delta";
import type { Change, ConversationView, Core, LiveState, Op, Project } from "@pi-everywhere/protocol";
import { expect } from "vitest";
import type { ContractTarget } from "./types";

export const WAIT_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(
  condition: () => boolean,
  what: string,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

export async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

export interface ViewTracker {
  readonly batches: readonly (readonly Op[])[];
  view(): ConversationView | null;
  stop(): Promise<void>;
}

export async function trackView(core: Core, conversationId: string): Promise<ViewTracker> {
  const batches: (readonly Op[])[] = [];
  let view: ConversationView | null | undefined;
  const watcher = await core.conversations.watch(conversationId, async (ops) => {
    batches.push(ops);
    view = applyImmutable<ConversationView | null>(view, ops);
  });
  await waitFor(() => batches.length > 0, "the first frame");
  return { batches, view: () => view ?? null, stop: () => watcher.stop() };
}

export function entryKinds(view: ConversationView | null): string[] {
  return view?.entries.map((entry) => entry.kind) ?? [];
}

export function isRunning(view: ConversationView | null): boolean {
  return (view?.docs["pi.live"] as LiveState | undefined)?.run !== undefined;
}

export async function waitForIdle(tracker: ViewTracker, expectedKind = "pi.assistant"): Promise<void> {
  await waitFor(
    () => !isRunning(tracker.view()) && entryKinds(tracker.view()).includes(expectedKind),
    "the run to end",
  );
}

export function collectChanges(core: Core): { changes: Change[]; stop: () => void } {
  const changes: Change[] = [];
  const stop = core.onChange((change) => changes.push(change));
  return { changes, stop };
}

export async function configure(core: Core): Promise<void> {
  await core.provider.setApiKey("sk-contract-test");
  const [model] = await core.provider.listModels();
  if (!model) throw new Error("The provider listed no models");
  await core.settings.setDefaultModel({ provider: model.provider, modelId: model.modelId });
}

export async function addProject(target: ContractTarget, name = "main"): Promise<Project> {
  return target.core.projects.add({ path: await target.paths.directory(name) });
}

export async function startConversation(target: ContractTarget) {
  await configure(target.core);
  const project = await addProject(target);
  const conversation = await target.core.conversations.create(project.id);
  return { project, conversation };
}

let requestCounter = 0;
export const nextRequestId = () => `request-${++requestCounter}`;
