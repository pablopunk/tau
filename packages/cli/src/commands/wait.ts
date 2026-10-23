import {
  type ConversationSummary,
  type ConversationView,
  executorOf,
  lastAssistantText,
  readLive,
} from "@tau/protocol";
import { CliExit, EXIT_TIMEOUT, failure } from "./cli-exit";
import { callRoute, type Server } from "./client";
import type { CommandEnv } from "./command-env";
import { connectLive } from "./live";
import { hasNativeEntries, nativeEntriesWithoutExecutorMessage } from "./native-text";
import { assessNativeThread } from "./wait-native";

export interface WaitRequest {
  readonly conversationId: string;
  /** `lastRunEndedAt` before the request; `null` for a new thread; `undefined` for `threads wait`. */
  readonly endedAfter: number | null | undefined;
  readonly timeoutSeconds: number;
}

export type Assessment =
  | { readonly state: "waiting" }
  | { readonly state: "done"; readonly answer: string }
  | { readonly state: "error"; readonly message: string };

const descendantsOf = (all: readonly ConversationSummary[], id: string): ConversationSummary[] => {
  const children = all.filter((item) => item.parentId === id);
  return [...children, ...children.flatMap((child) => descendantsOf(all, child.id))];
};

const runEndedAfter = (summary: ConversationSummary, endedAfter: number | null | undefined): boolean => {
  if (endedAfter === undefined) return true;
  if (summary.lastRunEndedAt === null) return false;
  return endedAfter === null || summary.lastRunEndedAt > endedAfter;
};

function errorMessageOf(view: ConversationView): string {
  for (const entry of [...view.entries].reverse()) {
    const message = entry.model?.[0] as { role?: string; errorMessage?: string } | undefined;
    if (message?.role === "assistant" && message.errorMessage) return message.errorMessage;
  }
  return "the thread ended in error";
}

const childRunningUnder = (all: readonly ConversationSummary[], id: string): boolean =>
  descendantsOf(all, id).some((child) => child.agentStatus === "running");

function assessPiThread(
  all: readonly ConversationSummary[],
  summary: ConversationSummary,
  view: ConversationView,
  endedAfter: number | null | undefined,
): Assessment {
  const conversationId = summary.id;
  if (hasNativeEntries(view)) {
    throw failure(nativeEntriesWithoutExecutorMessage(conversationId));
  }
  if (summary.status === "error" && runEndedAfter(summary, endedAfter)) {
    return { state: "error", message: errorMessageOf(view) };
  }
  const idle = summary.status === "idle";
  const live = readLive(view);
  const queueEmpty = live.queued.length === 0;
  const viewCaughtUp = !live.busy;
  const childRunning = childRunningUnder(all, conversationId);
  const settled = idle && runEndedAfter(summary, endedAfter) && queueEmpty && viewCaughtUp && !childRunning;
  return settled ? { state: "done", answer: lastAssistantText(view) } : { state: "waiting" };
}

/** The 4-condition rule: idle, a run ended after R0, an empty queue, and no running child. */
export function assessThread(
  all: readonly ConversationSummary[],
  conversationId: string,
  view: ConversationView,
  endedAfter: number | null | undefined,
): Assessment {
  const summary = all.find((item) => item.id === conversationId);
  if (!summary) throw failure(`not_found: Unknown conversation: ${conversationId}`);
  if (executorOf(summary) === "pi") return assessPiThread(all, summary, view, endedAfter);
  return assessNativeThread(summary, view, {
    endedAfterR0: runEndedAfter(summary, endedAfter),
    childRunning: childRunningUnder(all, conversationId),
  });
}

export const listAll = async (server: Server, env: CommandEnv) =>
  (await callRoute(server, "listAllConversations", {}, env)) as ConversationSummary[];

/** Resolves with the last assistant answer. Exits 1 on an error thread, 3 on timeout. */
export function waitForThread(server: Server, env: CommandEnv, request: WaitRequest): Promise<string> {
  const live = connectLive(server, env);
  live.subscribe(request.conversationId);
  return new Promise<string>((resolve, reject) => {
    let finished = false;
    let evaluating = false;
    let again = false;
    const cancels: (() => void)[] = [];
    const finish = (settle: () => void) => {
      if (finished) return;
      finished = true;
      for (const cancel of cancels) cancel();
      live.close();
      settle();
    };
    const check = async () => {
      const view = live.view(request.conversationId);
      if (view === undefined) return;
      if (view === null) throw failure(`not_found: Unknown conversation: ${request.conversationId}`);
      const all = await listAll(server, env);
      const result = assessThread(all, request.conversationId, view, request.endedAfter);
      if (result.state === "done") finish(() => resolve(result.answer));
      if (result.state === "error") finish(() => reject(failure(result.message)));
    };
    const evaluate = async () => {
      if (finished) return;
      if (evaluating) {
        again = true;
        return;
      }
      evaluating = true;
      try {
        do {
          again = false;
          await check();
        } while (again && !finished);
      } catch (error) {
        finish(() => reject(error));
      }
      evaluating = false;
    };
    const poll = () => {
      cancels.push(
        env.after(env.pollMs, () => {
          void evaluate();
          if (!finished) poll();
        }),
      );
    };
    live.onFrame(() => void evaluate());
    live.onClose(() => finish(() => reject(failure("Lost the connection to tau."))));
    cancels.push(
      env.after(request.timeoutSeconds * 1000, () =>
        finish(() => reject(new CliExit(EXIT_TIMEOUT, `Timed out after ${request.timeoutSeconds}s`))),
      ),
    );
    poll();
  });
}

/** `lastRunEndedAt` of a thread now (R0), or `null` when it has never run. */
export async function runEndedAtOf(
  server: Server,
  env: CommandEnv,
  conversationId: string,
): Promise<number | null> {
  const found = (await listAll(server, env)).find((item) => item.id === conversationId);
  if (!found) throw failure(`not_found: Unknown conversation: ${conversationId}`);
  return found.lastRunEndedAt;
}
