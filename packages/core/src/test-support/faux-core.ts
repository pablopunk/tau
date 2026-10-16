import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { applyImmutable } from "@earendil-works/chord/delta";
import type { ConversationView, Core, LiveState, Op, Project } from "@pi-everywhere/protocol";
import { createCoreWith, defaultCoreDependencies } from "../create-core";

export interface FauxWorld {
  readonly root: string;
  readonly home: string;
  core: Core;
  /** Closes the core and opens a new one on the same home. */
  reopen(): Promise<Core>;
  makeFolder(name: string): Promise<string>;
}

export async function openFauxWorld(root: string, now: () => number = Date.now): Promise<FauxWorld> {
  const home = join(root, "home");
  const open = () => createCoreWith({ home, faux: true }, { ...defaultCoreDependencies(), now });
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

export async function setUpConversation(world: FauxWorld) {
  const { core } = world;
  await core.provider.setApiKey("sk-test");
  const [model] = await core.provider.listModels();
  await core.settings.setDefaultModel({ provider: model?.provider ?? "", modelId: model?.modelId ?? "" });
  const project: Project = await core.projects.add({ path: await world.makeFolder("main") });
  const conversation = await core.conversations.create(project.id);
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

export async function waitForAnswer(tracker: ViewTracker): Promise<void> {
  await waitUntil(
    () => !isRunning(tracker.view()) && entryKinds(tracker.view()).includes("pi.assistant"),
    "the run to end",
  );
}
