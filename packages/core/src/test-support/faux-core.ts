import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { applyImmutable } from "@earendil-works/chord/delta";
import type { ConversationView, Core, LiveState, Op, Project } from "@tau/protocol";
import { createCoreWith, defaultCoreDependencies } from "../create-core";
import { NO_UPDATE_OPTIONS } from "./update-options";

export interface FauxWorld {
  readonly root: string;
  readonly home: string;
  core: Core;
  /** Closes the core and opens a new one on the same home. */
  reopen(): Promise<Core>;
  makeFolder(name: string): Promise<string>;
}

export async function openFauxWorld(
  root: string,
  now: () => number = Date.now,
  env: NodeJS.ProcessEnv = process.env,
  makeCore: (home: string) => Promise<Core> = (home) =>
    createCoreWith({ home, faux: true, ...NO_UPDATE_OPTIONS }, { ...defaultCoreDependencies(), now, env }),
): Promise<FauxWorld> {
  const home = join(root, "home");
  const open = () => makeCore(home);
  const world: FauxWorld = {
    root,
    home,
    core: await open(),
    async reopen() {
      await world.core.close();
      world.core = await open();
      return world.core;
    },
    async makeFolder(name) {
      const path = join(root, "projects", name);
      await mkdir(path, { recursive: true });
      return path;
    },
  };
  return world;
}

let setUpCounter = 0;

export async function setUpConversation(world: FauxWorld, firstText = "hello") {
  const { core } = world;
  await core.providers.setApiKey("openrouter", "sk-test");
  const [model] = await core.models.list();
  await core.settings.setDefaultModel({ provider: model?.provider ?? "", modelId: model?.modelId ?? "" });
  const project: Project = await core.projects.add({ path: await world.makeFolder("main") });
  const conversation = await core.conversations.start({
    projectId: project.id,
    text: firstText,
    requestId: `set-up-${++setUpCounter}`,
  });
  const tracker = await trackView(core, conversation.id);
  await waitForAnswer(tracker);
  await tracker.stop();
  return { project, conversation };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitUntil(condition: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

export interface ViewTracker {
  view(): ConversationView | null;
  stop(): Promise<void>;
}

export async function trackView(core: Core, conversationId: string): Promise<ViewTracker> {
  let view: ConversationView | null | undefined;
  const watcher = await core.conversations.watch(conversationId, async (ops: readonly Op[]) => {
    view = applyImmutable<ConversationView | null>(view, ops);
  });
  await waitUntil(() => view !== undefined, "the first frame");
  return { view: () => view ?? null, stop: () => watcher.stop() };
}

export const entryKinds = (view: ConversationView | null) => view?.entries.map((entry) => entry.kind) ?? [];
export const isRunning = (view: ConversationView | null) =>
  (view?.docs["pi.live"] as LiveState | undefined)?.run !== undefined;

const assistantCount = (view: ConversationView | null) =>
  entryKinds(view).filter((kind) => kind === "pi.assistant").length;

export const answerCount = (tracker: ViewTracker) => assistantCount(tracker.view());

export async function waitForAnswerAfter(tracker: ViewTracker, before: number): Promise<void> {
  await waitUntil(
    () => !isRunning(tracker.view()) && assistantCount(tracker.view()) > before,
    "the next answer",
  );
}

export async function waitForAnswer(tracker: ViewTracker): Promise<void> {
  await waitUntil(
    () => !isRunning(tracker.view()) && entryKinds(tracker.view()).includes("pi.assistant"),
    "the run to end",
  );
}
