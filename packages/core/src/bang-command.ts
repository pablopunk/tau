import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { AppError, type ProcessInfo, type ResourceSettings } from "@tau/protocol";
import { addTauEnvironment } from "./harness/coding-tools";
import type { IndexedConversation as IndexedEntry } from "./harness/conversation-docs";
import { indexOf, readMeta } from "./harness/conversation-index";
import type { NotificationSubmitter } from "./harness/notification-submitter";
import { bashPath, DEFAULT_TIMEOUT_SECONDS } from "./harness/tools/bash";
import { governedScope } from "./processes/governor/governed";
import { noticeNotification } from "./processes/process-notifications";
import type { StopReason } from "./processes/process-types";
import { cwdOf, type ThreadLookup } from "./terminals/cwd-of";

export type BangParse =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "escaped"; readonly text: string }
  | { readonly kind: "literal" };

const BANG_PATTERN = /^! (.+)$/s;

/**
 * Server-side `!` parsing. `! cmd` runs; `!!x` is a literal `!x` (one layer, here); anything else is plain text.
 * Bare `!` is `invalid_request` — the web Composer shows its own inline error first.
 */
export function parseBangCommand(text: string): BangParse {
  const trimmed = text.trim();
  if (trimmed === "!") {
    throw new AppError("invalid_request", "Type `! ` followed by a command, or `!!` for a literal `!`.");
  }
  if (trimmed.startsWith("!!")) return { kind: "escaped", text: text.replace(/^(\s*)!/, "$1") };
  const match = BANG_PATTERN.exec(trimmed);
  const command = match?.[1]?.trim();
  if (!command) return { kind: "literal" };
  return { kind: "command", command };
}

/** `! ls` titles as `ls`; everything else titles verbatim. The stored entry always keeps its `! ` prefix. */
export function stripBangPrefix(text: string): string {
  return BANG_PATTERN.exec(text.trim())?.[1] ?? text;
}

export interface BangCommandDeps {
  readonly threads: ThreadLookup;
  readonly processes: {
    start(request: {
      readonly conversationId: string;
      readonly cwd: string;
      readonly command: string;
      readonly shell: string;
      readonly env: Record<string, string>;
      readonly governed?: boolean;
      readonly notifyOnExit: true;
    }): Promise<ProcessInfo>;
    stop(id: string, reason?: StopReason): Promise<void>;
    resourceSettings(): ResourceSettings;
  };
  readonly notifications: NotificationSubmitter;
  readonly entryOf: (conversationId: string) => Promise<IndexedEntry | undefined>;
  /** Passed to the command as `TAU_HOME`; `undefined` when the home is unknown. */
  readonly home: string | undefined;
}

/** The calling thread's entry in its project index. Unknown or deleted threads are ungoverned. */
export function entryOfThread(harness: Harness, conversationId: string): Promise<IndexedEntry | undefined> {
  if (!/^[1-9]\d*$/.test(conversationId)) return Promise.resolve(undefined);
  const id = Number(conversationId) as ConversationId;
  return readMeta(harness, id)
    .then((meta) => {
      if (!meta) return undefined;
      return indexOf(harness, meta.projectId).then((entries) =>
        entries.find((entry) => entry.conversationId === Number(id)),
      );
    })
    .catch(() => undefined);
}

/**
 * Spawns a bang command after admission. Awaits `start` only — never the exit — and never rejects: a spawn failure
 * submits an `app.notice` entry so the thread still tells the model what happened.
 */
export async function runBangCommand(
  deps: BangCommandDeps,
  conversationId: string,
  command: string,
): Promise<void> {
  try {
    const cwd = await cwdOf(deps.threads, conversationId);
    const scope = await governedScope(deps.processes.resourceSettings(), () => deps.entryOf(conversationId));
    const env: Record<string, string> = {};
    addTauEnvironment(deps.home, env, conversationId);
    const info = await deps.processes.start({
      conversationId,
      cwd,
      command,
      shell: bashPath(),
      env,
      ...(scope && { governed: true, scope }),
      notifyOnExit: true,
    });
    const timer = setTimeout(() => {
      deps.processes.stop(info.id, "timeout").catch(() => undefined);
    }, DEFAULT_TIMEOUT_SECONDS * 1000);
    // The kill is best-effort; it must not hold the event loop open for tests or shutdown.
    timer.unref?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.notifications
      .notify(
        conversationId,
        noticeNotification(`Command failed to start: ${message}`, `bang:${conversationId}:${Date.now()}`),
      )
      .catch(() => undefined);
  }
}
