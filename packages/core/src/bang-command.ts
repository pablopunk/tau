import { type ConversationId, defineDoc, type Harness } from "@earendil-works/pi-durable";
import {
  AppError,
  BANG_KIND,
  type FileRef,
  PROCESS_EXIT_KIND,
  type ProcessInfo,
  type ProcessOrigin,
  type ResourceSettings,
  type SandboxSettings,
} from "@tau/protocol";
import { titleFromFirstMessage } from "./conversation-title";
import { addTauEnvironment } from "./harness/coding-tools";
import type { IndexedConversation as IndexedEntry } from "./harness/conversation-docs";
import {
  indexOf,
  readMeta,
  scanAppConversations,
  updateLiveConversation,
} from "./harness/conversation-index";
import {
  bangSlotHolder,
  releaseBangSlot,
  submitUnlocked,
  takeBangSlot,
  withAdmissionGate,
} from "./harness/conversation-submit";
import type { NotificationSubmitter } from "./harness/notification-submitter";
import { BACKGROUND } from "./harness/open";
import { BACKGROUND_TIMEOUT_SCALE, bashPath, DEFAULT_TIMEOUT_SECONDS } from "./harness/tools/bash";
import { callScopes, type SandboxScope, scopeFields, type ThreadClass } from "./processes/governor/governed";
import { interruptedBangText, noticeNotification } from "./processes/process-notifications";
import type { StopReason } from "./processes/process-types";
import { cwdOf, type ThreadLookup } from "./terminals/cwd-of";
import type { UploadStore } from "./upload-store";

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
      readonly scope?: ThreadClass;
      readonly sandboxScope?: SandboxScope;
      readonly origin?: ProcessOrigin;
      readonly notifyOnExit: true;
      readonly timeoutMs?: number;
    }): Promise<ProcessInfo>;
    stop(id: string, reason?: StopReason): Promise<void>;
    resourceSettings(): ResourceSettings;
    sandboxSettings(): SandboxSettings;
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
 * Returns whether the process started; the dispatcher releases the slot and drops the marker when it did not.
 */
export async function runBangCommand(
  deps: BangCommandDeps,
  conversationId: string,
  command: string,
): Promise<boolean> {
  try {
    const cwd = await cwdOf(deps.threads, conversationId);
    const scopes = await callScopes(deps.processes.resourceSettings(), deps.processes.sandboxSettings(), () =>
      deps.entryOf(conversationId),
    );
    const scope = scopes.governedScope;
    const env: Record<string, string> = {};
    addTauEnvironment(deps.home, env, conversationId);
    const slow =
      scope && deps.processes.resourceSettings().levels[scope] === "background"
        ? BACKGROUND_TIMEOUT_SCALE
        : 1;
    const info = await deps.processes.start({
      conversationId,
      cwd,
      command,
      shell: bashPath(),
      env,
      ...scopeFields(scopes),
      origin: "bang",
      notifyOnExit: true,
      timeoutMs: DEFAULT_TIMEOUT_SECONDS * slow * 1000,
    });
    const timer = setTimeout(
      () => {
        deps.processes.stop(info.id, "timeout").catch(() => undefined);
      },
      DEFAULT_TIMEOUT_SECONDS * slow * 1000,
    );
    // The kill is best-effort; it must not hold the event loop open for tests or shutdown.
    timer.unref?.();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.notifications
      .notify(
        conversationId,
        noticeNotification(`Command failed to start: ${message}`, `bang:${conversationId}:${Date.now()}`),
      )
      .catch(() => undefined);
    return false;
  }
}

export type BangMarker = {
  readonly command: string;
  readonly entryId: number | null;
};

/**
 * Durable at-most-once marker, keyed by admission `requestId`. Written after
 * admission and before the spawn: on boot, bangs with no marker are
 * re-dispatched exactly once (the spawn never happened), while marked bangs
 * are never re-run — marked without an exit, they get an interruption notice.
 */
export const BangDoc = defineDoc<Record<string, BangMarker>>({
  kind: "app.bang-dispatch",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({}),
});

const bangNotFound = () => new AppError("not_found", "Conversation not found.");

async function readMarkers(
  harness: Harness,
  conversationId: ConversationId,
): Promise<Record<string, BangMarker>> {
  const markers = await harness.commit(async (tx) => {
    const doc = await tx.doc(BangDoc, conversationId);
    return JSON.parse(JSON.stringify(doc)) as Record<string, BangMarker>;
  }, BACKGROUND);
  return markers;
}

async function writeMarker(
  harness: Harness,
  conversationId: ConversationId,
  requestId: string,
  marker: BangMarker,
): Promise<void> {
  await harness.commit(async (tx) => {
    const doc = await tx.doc(BangDoc, conversationId);
    doc[requestId] = { ...marker };
  }, BACKGROUND);
}

export async function dropBangMarker(
  harness: Harness,
  conversationId: ConversationId,
  requestId: string,
): Promise<void> {
  await harness.commit(async (tx) => {
    const doc = await tx.doc(BangDoc, conversationId);
    delete doc[requestId];
  }, BACKGROUND);
}

export interface BangRuntimeDeps extends BangCommandDeps {
  readonly harness: Harness;
  /** Staged file refs validate through this before admission. */
  readonly uploads?: Pick<UploadStore, "resolveRefs">;
}

export interface BangAdmission {
  readonly projectId: string;
  /** Set when this send gave an untitled thread its provisional title: the title job should run. */
  readonly titleText?: string;
  /** False when another send with the same `requestId` won: nothing was admitted and nothing spawns. */
  readonly admitted: boolean;
  readonly submissionId: number;
  readonly entryId?: number;
}

export interface BangInput {
  readonly text: string;
  readonly images?: readonly unknown[];
  readonly files?: readonly FileRef[];
  readonly requestId: string;
}

const bangSlotRefused = () =>
  new AppError("invalid_request", "A command is already running in this thread. Wait for it to finish.");

/**
 * Admits `! cmd` as a display-only `app.bang` row — never as model input —
 * then dispatches it, all under the per-conversation gate. Exactly one
 * admission and one spawn per `requestId`: a concurrent second send with
 * another id is refused with `invalid_request` before any row is admitted,
 * while a duplicate id returns the existing receipt without spawning.
 */
export async function admitAndDispatchBang(
  deps: BangRuntimeDeps,
  conversationId: string,
  input: BangInput,
  now: number,
): Promise<BangAdmission> {
  const bang = parseBangCommand(input.text);
  if (bang.kind !== "command") throw new AppError("invalid_request", "Not a bang command.");
  // No attachments on a display-only row: refusing beats silently dropping them; the composer restores both.
  if ((input.images ?? []).length > 0 || (input.files ?? []).length > 0) {
    throw new AppError(
      "invalid_request",
      "Attachments on `!` commands are ignored: send the text or the files.",
    );
  }
  // No exec without a folder, and no row when the thread is gone.
  await cwdOf(deps.threads, conversationId);
  const conversationIdNum = Number(conversationId) as ConversationId;
  const planned = await withAdmissionGate(conversationId, async () => {
    if (bangSlotHolder(conversationId) !== undefined && bangSlotHolder(conversationId) !== input.requestId) {
      throw bangSlotRefused();
    }
    const conversation = await deps.harness.conversation(conversationIdNum, BACKGROUND);
    if (!conversation) throw bangNotFound();
    const summary = await deps.threads.find(conversationId);
    if (!summary) throw bangNotFound();
    const receipt = await submitUnlocked(deps.harness, conversation, {
      type: "write",
      entry: { kind: BANG_KIND, data: { command: bang.command } },
      requestId: input.requestId,
    });
    if (!receipt.admitted) {
      // A loser deduped by `requestId` never execs; its spawn already ran or is running under the marker.
      return { summary, receipt, spawn: false as const, titleText: undefined as string | undefined };
    }
    // Claiming an orphaned admission (a crash between admission and the
    // marker) looks the same as a fresh one from here on.
    takeBangSlot(conversationId, input.requestId);
    try {
      const markers = await readMarkers(deps.harness, conversationIdNum);
      if (!markers[input.requestId]) {
        await writeMarker(deps.harness, conversationIdNum, input.requestId, {
          command: bang.command,
          entryId: receipt.entryId ?? null,
        });
      }
      let titleText: string | undefined;
      await updateLiveConversation(deps.harness, conversationIdNum, summary.projectId, (meta, entry) => {
        if (meta.title === "") {
          meta.title = titleFromFirstMessage(bang.command, []);
          titleText = bang.command;
        }
        entry.title = meta.title;
        entry.updatedAt = now;
        delete entry.archivedAt;
        return true;
      });
      return { summary, receipt, spawn: true as const, titleText };
    } catch (error) {
      releaseBangSlot(conversationId);
      throw error;
    }
  });
  const { summary, receipt, spawn, titleText } = planned;
  if (spawn) {
    const started = await runBangCommand(deps, conversationId, bang.command);
    if (!started) {
      releaseBangSlot(conversationId);
      await dropBangMarker(deps.harness, conversationIdNum, input.requestId).catch(() => undefined);
    }
  }
  const admission: BangAdmission = {
    projectId: summary.projectId,
    ...(titleText === undefined ? {} : { titleText }),
    admitted: receipt.admitted,
    submissionId: receipt.submissionId,
    ...(receipt.entryId === undefined ? {} : { entryId: receipt.entryId }),
  };
  return admission;
}

/**
 * Spawns an admitted-but-undispatched bang (a first message, or a sweep
 * find): a no-op when the marker says it already ran or is running, or when
 * another bang holds the slot.
 */
export async function dispatchBang(
  deps: BangRuntimeDeps,
  conversationId: string,
  command: string,
  requestId: string,
): Promise<boolean> {
  const conversationIdNum = Number(conversationId) as ConversationId;
  const claimed = await withAdmissionGate(conversationId, async () => {
    if (bangSlotHolder(conversationId) !== undefined) return false;
    const markers = await readMarkers(deps.harness, conversationIdNum);
    if (markers[requestId]) return false;
    takeBangSlot(conversationId, requestId);
    try {
      await writeMarker(deps.harness, conversationIdNum, requestId, { command, entryId: null });
    } catch (error) {
      releaseBangSlot(conversationId);
      throw error;
    }
    return true;
  });
  if (!claimed) return false;
  const started = await runBangCommand(deps, conversationId, command);
  if (!started) {
    releaseBangSlot(conversationId);
    await dropBangMarker(deps.harness, conversationIdNum, requestId).catch(() => undefined);
  }
  return started;
}

interface BangEntry {
  readonly id: number;
  readonly command: string;
}

interface ExitEntry {
  readonly id: number;
  readonly command: string;
}

function commandOf(entry: { data?: unknown }): string | undefined {
  if (typeof entry.data !== "object" || entry.data === null) return undefined;
  const command = (entry.data as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}

export interface BangRecovery {
  readonly redispatched: number;
  readonly interrupted: number;
}

/**
 * Boot sweep for the crash window between admission and spawn. Bangs with no
 * marker never spawned, so they are re-dispatched exactly once; bangs with a
 * marker but no exit were cut off by the restart, so they get an interruption
 * notice and are never re-run. Never matches on "no process record": finished
 * processes leave no rows, so that predicate would re-run all of history.
 */
export async function recoverBangs(deps: BangRuntimeDeps): Promise<BangRecovery> {
  let redispatched = 0;
  let interrupted = 0;
  for (const { id, meta } of await scanAppConversations(deps.harness)) {
    if (meta.deletedAt !== undefined) continue;
    const conversationId = String(id);
    const conversation = await deps.harness.conversation(id, BACKGROUND);
    if (!conversation) continue;
    const settled = await withAdmissionGate(conversationId, async () => {
      const { entries } = await conversation.context(BACKGROUND);
      const bangs: BangEntry[] = [];
      const exits: ExitEntry[] = [];
      for (const entry of entries) {
        if (entry.kind === BANG_KIND) {
          const command = commandOf(entry);
          if (command !== undefined) bangs.push({ id: Number(entry.id), command });
        } else if (entry.kind === PROCESS_EXIT_KIND) {
          const command = commandOf(entry);
          if (command !== undefined) exits.push({ id: Number(entry.id), command });
        }
      }
      const markers = await readMarkers(deps.harness, id);
      const claimedExits = new Set<number>();
      const pairedBang = new Set<number>();
      // Attribute markers to bang entries so the exit check reads "after the bang", never older history.
      const remaining = new Map<string, BangMarker>(Object.entries(markers));
      for (const bang of bangs) {
        for (const [requestId, marker] of remaining) {
          const matchesEntry = marker.entryId === bang.id;
          const matchesCommand = marker.entryId === null && marker.command === bang.command;
          if (matchesEntry || matchesCommand) {
            remaining.delete(requestId);
            pairedBang.add(bang.id);
            // Re-key so the exit search below sees the pairing.
            markers[requestId] = { command: marker.command, entryId: bang.id };
            break;
          }
        }
      }
      const spawn: BangEntry[] = [];
      // Notices go out AFTER the gate is released: notification delivery is
      // itself gated, so notifying under the gate would deadlock on re-entry.
      // The notice requestId is stable, so a crash between the notice and
      // the marker drop re-sends as a deduped no-op on the next sweep.
      const interrupt: Array<{ requestId: string; command: string }> = [];
      const drop: string[] = [];
      for (const [requestId, marker] of Object.entries(markers)) {
        const afterId = marker.entryId ?? 0;
        const exit = exits.find(
          (candidate) =>
            !claimedExits.has(candidate.id) && candidate.command === marker.command && candidate.id > afterId,
        );
        if (exit) {
          claimedExits.add(exit.id);
          drop.push(requestId);
          continue;
        }
        if (remaining.has(requestId)) {
          // No bang row and no exit: the admission itself never landed. Drop the stale marker.
          drop.push(requestId);
          continue;
        }
        interrupt.push({ requestId, command: marker.command });
      }
      for (const requestId of drop) await dropBangMarker(deps.harness, id, requestId);
      for (const bang of bangs) {
        if (!pairedBang.has(bang.id)) spawn.push(bang);
      }
      return { spawn, interrupt };
    });
    for (const notice of settled.interrupt) {
      await deps.notifications
        .notify(conversationId, {
          kind: "app.notice",
          data: { text: interruptedBangText(notice.command) },
          text: `<notice>${interruptedBangText(notice.command)}</notice>`,
          requestId: `bang:${conversationId}:${notice.requestId}:interrupted`,
        })
        .catch(() => undefined);
      // The notice is durably admitted (or deduped) before the marker goes.
      await withAdmissionGate(conversationId, () => dropBangMarker(deps.harness, id, notice.requestId));
      interrupted += 1;
    }
    for (const bang of settled.spawn) {
      if (await dispatchBang(deps, conversationId, bang.command, `bang-retry:${bang.id}`)) {
        redispatched += 1;
      }
    }
  }
  return { redispatched, interrupted };
}
