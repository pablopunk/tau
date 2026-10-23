import { applyImmutable } from "@earendil-works/chord/delta";
import type { ConversationSummary, ConversationView, Core } from "@tau/protocol";
import { type CoreDependencies, createCoreWith, defaultCoreDependencies } from "../../create-core";
import type { NativeQueryFn } from "../native/controller";
import type { ExecutorKind, Marks } from "./stages";

const CLAUDE_INSTALLED: Partial<CoreDependencies> = { claudeCodeInstalled: async () => true };
const POLL_MS = 25;
const FAKE_PROVIDER_KEY = "sk-benchmark-not-a-credential";
const OFFLINE_UPDATES = {
  currentVersion: "0.0.0-benchmark",
  latestVersion: (): Promise<string> => Promise.reject(new Error("offline")),
} as const;

type Clock = () => number;

export async function openBenchmarkCore(
  home: string,
  executor: ExecutorKind,
  nativeQuery?: NativeQueryFn,
): Promise<Core> {
  const installed = executor === "claude-code" ? CLAUDE_INSTALLED : {};
  return createCoreWith(
    { home, faux: true, ...OFFLINE_UPDATES },
    { ...defaultCoreDependencies(), env: {}, ...installed, ...(nativeQuery && { nativeQuery }) },
  );
}

/** Both executors need a default model to start; the faux provider takes any key. */
export async function configureFauxDefaults(core: Core): Promise<void> {
  await core.providers.setApiKey("openrouter", FAKE_PROVIDER_KEY);
  const [model] = await core.models.list();
  if (!model) throw new Error("the faux provider lists no model");
  await core.settings.setDefaultModel({ provider: model.provider, modelId: model.modelId });
}

export interface RunEndObserver {
  waitForEnd(projectId: string, threadId: string, timeoutMs: number): Promise<ConversationSummary>;
  stop(): void;
}

/** Lists the project's threads on every change event, and every POLL_MS as a fallback. */
export function observeRunEnds(core: Core): RunEndObserver {
  const wakeups = new Set<() => void>();
  const stop = core.onChange(() => {
    for (const wake of wakeups) wake();
  });
  const nextWakeup = (): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(done, POLL_MS);
      wakeups.add(done);
      function done() {
        clearTimeout(timer);
        wakeups.delete(done);
        resolve();
      }
    });
  return {
    stop,
    async waitForEnd(projectId, threadId, timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        const found = (await core.conversations.list(projectId)).find((thread) => thread.id === threadId);
        if (found && found.lastRunEndedAt !== null) return found;
        if (performance.now() > deadline) throw new Error(`the run did not end within ${timeoutMs} ms`);
        await nextWakeup();
      }
    },
  };
}

const hasAssistantText = (view: ConversationView | null | undefined): boolean =>
  view?.entries.some(
    (entry) =>
      entry.kind === "pi.assistant" &&
      entry.model?.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some((block) => block.type === "text" && block.text.trim().length > 0),
      ),
  ) ?? false;

export interface FirstAssistantWatch {
  readonly seenAtAttach: () => boolean;
  stop(): Promise<void>;
}

/** Marks `firstText` when the watched view first holds nonempty assistant text. */
export async function watchFirstAssistant(
  core: Core,
  threadId: string,
  marks: Marks,
  now: Clock,
): Promise<FirstAssistantWatch> {
  let view: ConversationView | null | undefined;
  let frames = 0;
  let seenAtAttach = false;
  const watcher = await core.conversations.watch(threadId, async (ops) => {
    view = applyImmutable<ConversationView | null>(view, ops);
    frames += 1;
    if (!hasAssistantText(view) || marks.firstText !== undefined) return;
    marks.firstText = now();
    seenAtAttach = frames === 1;
  });
  return { seenAtAttach: () => seenAtAttach, stop: () => watcher.stop() };
}
