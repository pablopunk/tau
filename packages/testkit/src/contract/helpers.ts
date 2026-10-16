import { applyImmutable } from "@earendil-works/chord/delta";
import type {
  Change,
  ConversationSummary,
  ConversationView,
  Core,
  ImageInput,
  LiveState,
  Op,
  Project,
} from "@pi-everywhere/protocol";
import { expect } from "vitest";
import type { ContractTarget } from "./types";

export const WAIT_TIMEOUT_MS = 20_000;
export const FAST_MODEL = { provider: "faux", modelId: "faux-fast" };
export const TEXT_ONLY_MODEL = { provider: "faux", modelId: "faux-text" };
export const SECOND_MODEL = { provider: "faux", modelId: "faux-2" };

export const TINY_PNG: ImageInput = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
};
export const JPEG_BYTES_AS_PNG: ImageInput = { mimeType: "image/png", data: "/9j/4AAQSkZJRgABAQEASABIAAD" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
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

export async function waitForSummary(
  core: Core,
  conversation: Pick<ConversationSummary, "id" | "projectId">,
  matches: (summary: ConversationSummary) => boolean,
  what: string,
): Promise<ConversationSummary> {
  let found: ConversationSummary | undefined;
  await waitFor(async () => {
    found = (await core.conversations.list(conversation.projectId)).find(
      (item) => item.id === conversation.id,
    );
    return found !== undefined && matches(found);
  }, what);
  return found as ConversationSummary;
}

export async function summaryOf(core: Core, conversation: Pick<ConversationSummary, "id" | "projectId">) {
  const found = (await core.conversations.list(conversation.projectId)).find(
    (item) => item.id === conversation.id,
  );
  if (!found) throw new Error(`No summary for conversation ${conversation.id}`);
  return found;
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

export async function configureWithFastModel(core: Core): Promise<void> {
  await configure(core);
  await core.settings.setFastModel(FAST_MODEL);
}

export async function addProject(target: ContractTarget, name = "main"): Promise<Project> {
  return target.core.projects.add({ path: await target.paths.directory(name) });
}

let requestCounter = 0;
export const nextRequestId = () => `request-${++requestCounter}`;

export interface StartOptions {
  readonly text?: string;
  readonly projectId?: string;
  readonly images?: ImageInput[];
  readonly model?: { provider: string; modelId: string };
  readonly requestId?: string;
}

/** Configures the core (unless it already is), adds a project and starts a thread. */
export async function startConversation(target: ContractTarget, options: StartOptions = {}) {
  const { core } = target;
  if (!(await core.provider.status()).configured) await configure(core);
  const project = options.projectId
    ? ((await core.projects.list()).find((item) => item.id === options.projectId) as Project)
    : await addProject(target);
  const conversation = await core.conversations.start({
    projectId: project.id,
    text: options.text ?? "hello",
    images: options.images,
    model: options.model,
    requestId: options.requestId ?? nextRequestId(),
  });
  return { project, conversation };
}

export async function userProjects(core: Core): Promise<Project[]> {
  return (await core.projects.list()).filter((project) => project.kind !== "home");
}
