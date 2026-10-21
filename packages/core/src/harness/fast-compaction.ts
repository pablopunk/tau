import type { Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import {
  type CompactionHooks,
  defineExtension,
  type EntryId,
  type EntryRecord,
  type Extension,
  type HookApi,
} from "@earendil-works/pi-durable";
import { AppError, type CompactionSettings } from "@tau/protocol";
import type { FileCredentialStore } from "../auth/file-credential-store";
import {
  type AvailabilityCache,
  createAvailabilityCache,
  isDecisionsNotFound,
} from "../decisions/availability";
import type { DecideClient } from "../decisions/client";
import { createOpenaiClient } from "../decisions/openai";
import { pick } from "../decisions/selector";
import { createTypesafeClient } from "../decisions/typesafe";
import type { SettingsStore } from "../home/settings-store";

export interface FastCompactionThresholds {
  preserveRecentMessages: number;
  keepThreshold: number;
  truncateHeadChars: number;
  minReductionRatio: number;
  predicateTimeoutMs: number;
}

export const FAST_COMPACTION_DEFAULTS: FastCompactionThresholds = {
  /** First frame plus frames touching this many newest messages are never scored. */
  preserveRecentMessages: 6,
  /** Both questions above this keep a frame verbatim; one above truncates; else drop. */
  keepThreshold: 0.5,
  /** Kept head of a truncated tool result, in characters. */
  truncateHeadChars: 300,
  /** Below this reduction the hook defers to the built-in summarizer. */
  minReductionRatio: 0.25,
  /** Hard race per predicate call; the client fetch has its own shorter timeout. */
  predicateTimeoutMs: 60_000,
};

export interface FastCompactionDeps {
  readonly settingsStore: Pick<SettingsStore, "get">;
  readonly credentials: Pick<FileCredentialStore, "read">;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchFn?: typeof fetch;
  /** Test seam: fixed clients instead of live backends. No network in tests, ever. */
  readonly decideClients?: readonly DecideClient[];
  readonly thresholds?: Partial<FastCompactionThresholds>;
  readonly availability?: AvailabilityCache;
}

interface Frame {
  readonly entryIds: readonly EntryId[];
  readonly callText: string;
  readonly resultText: string;
}

type FrameVerdict = "keep" | "truncate" | "drop";

interface ScoredFrame {
  readonly verdict: FrameVerdict;
  readonly callScore: number;
  readonly resultScore: number;
}

async function typesafeKeyOf(deps: FastCompactionDeps): Promise<string | undefined> {
  const stored = await deps.credentials.read("typesafe").catch(() => undefined);
  if (stored?.type === "api_key") return stored.key;
  return deps.env.TYPESAFE_API_KEY ?? undefined;
}

function buildClients(
  deps: FastCompactionDeps,
  api: HookApi,
  preference: CompactionSettings["backend"],
): DecideClient[] {
  const all: DecideClient[] =
    deps.decideClients !== undefined
      ? [...deps.decideClients]
      : [
          createTypesafeClient({
            readCredential: () => typesafeKeyOf(deps),
            env: deps.env,
            ...(deps.fetchFn && { fetchFn: deps.fetchFn }),
          }),
          createOpenaiClient({
            getAuth: (providerId) => api.models.getAuth(providerId),
            env: deps.env,
            ...(deps.fetchFn && { fetchFn: deps.fetchFn }),
          }),
        ];
  if (preference === "auto") return all;
  // An explicit backend pins one; the other stays as a soft fallback to built-in via undefined.
  const pinned = pick(preference, all);
  return pinned ? [pinned, ...all.filter((client) => client !== pinned)] : [];
}

async function clientKey(
  deps: FastCompactionDeps,
  api: HookApi,
  client: DecideClient,
): Promise<string | undefined> {
  if (client.id === "typesafe") return typesafeKeyOf(deps);
  return (await api.models.getAuth("openai").catch(() => undefined))?.auth.apiKey;
}

function withHookTimeout<T>(
  promise: Promise<T>,
  ms: number,
  abortSignal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const guarded = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new AppError("internal", `${label} timed out.`)), ms);
    if (abortSignal) {
      if (abortSignal.aborted) {
        reject(new AppError("internal", `${label} was aborted.`));
        return;
      }
      onAbort = () => reject(new AppError("internal", `${label} was aborted.`));
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
    promise.then(resolve, reject);
  });
  return guarded.finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (abortSignal && onAbort) abortSignal.removeEventListener("abort", onAbort);
  });
}

function textBlocks(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content as readonly { type?: unknown; text?: unknown }[]) {
    if (block?.type === "text" && typeof block.text === "string") out.push(block.text);
  }
  return out;
}

function messageText(message: Message): string {
  switch (message.role) {
    case "user":
      return textBlocks(message.content).join("\n");
    case "assistant":
      return (message.content as readonly { type: string }[])
        .map((block) => {
          if (block.type === "text") return (block as { text?: string }).text ?? "";
          if (block.type === "toolCall") {
            const call = block as { name?: string; arguments?: unknown };
            return `[tool call ${call.name ?? "?"} ${JSON.stringify(call.arguments ?? {})}]`;
          }
          return "";
        })
        .filter((part) => part !== "")
        .join("\n");
    case "toolResult": {
      const result = message as { toolName?: string; content: unknown };
      return `[tool result ${result.toolName ?? "?"}]\n${textBlocks(result.content).join("\n")}`;
    }
    default:
      return "";
  }
}

function assistantHasToolCall(message: Message): boolean {
  return (
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    (message.content as readonly { type: string }[]).some((block) => block.type === "toolCall")
  );
}

/** One frame = one assistant tool-call block + its result entries, kept/dropped atomically. */
export function groupFrames(entries: readonly EntryRecord[]): Frame[] {
  const frames: Frame[] = [];
  let callParts: string[] = [];
  let resultParts: string[] = [];
  let entryIds: EntryId[] = [];
  const flush = (): void => {
    if (entryIds.length === 0) return;
    frames.push({ entryIds, callText: callParts.join("\n"), resultText: resultParts.join("\n") });
    callParts = [];
    resultParts = [];
    entryIds = [];
  };
  for (const entry of entries) {
    const models = entry.model ?? [];
    const startsCall = models.some(assistantHasToolCall);
    const hasResult = models.some((message) => message.role === "toolResult");
    if (entryIds.length > 0 && (startsCall || !hasResult)) flush();
    entryIds.push(entry.id);
    for (const message of models) {
      if (message.role === "toolResult") resultParts.push(messageText(message));
      else if (message.role !== "system") callParts.push(messageText(message));
    }
    if (!startsCall && !hasResult) flush();
  }
  flush();
  return frames.filter((frame) => frame.callText.trim() !== "" || frame.resultText.trim() !== "");
}

/** First message plus newest N messages pin their frames; pinned frames are never scored. */
function pinnedEntryIds(entries: readonly EntryRecord[], preserveRecentMessages: number): Set<EntryId> {
  const owned: EntryId[] = [];
  for (const entry of entries) {
    for (const _message of entry.model ?? []) owned.push(entry.id);
  }
  const pinned = new Set<EntryId>();
  if (owned.length === 0) return pinned;
  pinned.add(owned[0] as EntryId);
  for (const id of owned.slice(Math.max(0, owned.length - preserveRecentMessages))) pinned.add(id);
  return pinned;
}

const KEEP_CALL_QUESTION = "Is this tool call worth keeping in the compacted transcript?";
const KEEP_RESULT_QUESTION = "Is this tool result worth keeping in full in the compacted transcript?";

async function scoreFrame(
  client: DecideClient,
  frame: Frame,
  thresholds: FastCompactionThresholds,
  abortSignal: AbortSignal | undefined,
): Promise<ScoredFrame> {
  const [callScore, resultScore] = await Promise.all([
    withHookTimeout(
      client.predicate(frame.callText, KEEP_CALL_QUESTION),
      thresholds.predicateTimeoutMs,
      abortSignal,
      "Fast-compaction predicate",
    ),
    withHookTimeout(
      client.predicate(frame.resultText, KEEP_RESULT_QUESTION),
      thresholds.predicateTimeoutMs,
      abortSignal,
      "Fast-compaction predicate",
    ),
  ]);
  if (callScore > thresholds.keepThreshold && resultScore > thresholds.keepThreshold) {
    return { verdict: "keep", callScore, resultScore };
  }
  if (callScore > thresholds.keepThreshold || resultScore > thresholds.keepThreshold) {
    return { verdict: "truncate", callScore, resultScore };
  }
  return { verdict: "drop", callScore, resultScore };
}

function renderFrame(frame: Frame, scored: ScoredFrame, truncateHeadChars: number): string {
  const head = `## tool exchange (keep=${scored.callScore.toFixed(2)}/${scored.resultScore.toFixed(2)})`;
  if (scored.verdict === "keep") return `${head}\n${frame.callText}\n${frame.resultText}`.trimEnd();
  const truncated = frame.resultText.slice(0, truncateHeadChars);
  return (
    `${head} [result truncated to ${truncateHeadChars} chars]\n` +
    `${frame.callText}\n${truncated}\n[truncated: ${frame.resultText.length - truncated.length} more chars omitted]`
  ).trimEnd();
}

export interface FastCompactionOutcome {
  readonly summary: string;
  readonly backend: DecideClient["id"];
}

export async function runFastCompaction(
  deps: FastCompactionDeps,
  entries: readonly EntryRecord[],
  api: HookApi,
  context: Context,
): Promise<FastCompactionOutcome | undefined> {
  const thresholds: FastCompactionThresholds = { ...FAST_COMPACTION_DEFAULTS, ...deps.thresholds };
  const compaction = (await deps.settingsStore.get().catch(() => undefined))?.compaction;
  if (compaction?.mode !== "fast") return undefined;
  const clients = buildClients(deps, api, compaction.backend);
  if (clients.length === 0) return undefined;
  const frames = groupFrames(entries);
  if (frames.length === 0) return undefined;
  const pinned = pinnedEntryIds(entries, thresholds.preserveRecentMessages);
  const isPinned = (frame: Frame): boolean => frame.entryIds.some((id) => pinned.has(id));
  const scored = frames.filter((frame) => !isPinned(frame));
  const kept = frames.filter(isPinned);
  if (scored.length === 0) return undefined;
  const availability = deps.availability ?? createAvailabilityCache();
  const frameChars = (frame: Frame): number => frame.callText.length + frame.resultText.length;
  const originalChars = frames.reduce((total, frame) => total + frameChars(frame), 0);
  if (originalChars === 0) return undefined;
  const liveKeys = deps.decideClients === undefined;
  for (const client of clients) {
    try {
      const key = liveKeys ? await clientKey(deps, api, client) : "test-key";
      // Never wait on a probe: a demoted backend skips, anything else tries live.
      if (key === undefined || availability.peek(client, key) === "unavailable") continue;
      const verdicts = await Promise.all(
        scored.map((frame) => scoreFrame(client, frame, thresholds, context.abortSignal)),
      );
      const rendered = scored.flatMap((frame, index) => {
        const verdict = (verdicts[index] as ScoredFrame).verdict;
        if (verdict === "drop") return [];
        return [renderFrame(frame, verdicts[index] as ScoredFrame, thresholds.truncateHeadChars)];
      });
      const summaryChars =
        kept.reduce((total, frame) => total + frameChars(frame), 0) + rendered.join("\n").length;
      // Below the floor the built-in summarizer still places a summary; never decline.
      if (1 - summaryChars / originalChars < thresholds.minReductionRatio) return undefined;
      const diagnostics = scored.map(
        (frame, index) =>
          `decisions: frame=${frame.entryIds.join("+")} keep=${(verdicts[index] as ScoredFrame).callScore.toFixed(2)}/${(verdicts[index] as ScoredFrame).resultScore.toFixed(2)} verdict=${(verdicts[index] as ScoredFrame).verdict}`,
      );
      const summary = [
        `<fast-compaction backend=${client.id}>`,
        ...kept.map((frame) => `${frame.callText}\n${frame.resultText}`.trimEnd()),
        ...rendered,
        ...diagnostics,
        `reduction=${(1 - summaryChars / originalChars).toFixed(2)}`,
        `</fast-compaction>`,
      ].join("\n");
      return { summary, backend: client.id };
    } catch (error) {
      if (isDecisionsNotFound(error)) {
        await clientKey(deps, api, client).then((key) => availability.reportNotFound(client, key));
      }
    }
  }
  // Fallback is ALWAYS undefined (run built-in). Never decline: declining manual
  // `/compact` surfaces `nothing_to_compact`, declining overflow FAILS the run.
  return undefined;
}

export function makeFastCompactionExtension(deps: FastCompactionDeps): Extension {
  const beforeCompact: CompactionHooks["beforeCompact"] = async (compaction, api, context) => {
    // A focused manual compact defers to the built-in summarizer, which honors instructions.
    if (compaction.instructions !== undefined) return undefined;
    try {
      const outcome = await runFastCompaction(deps, compaction.entries, api, context);
      if (!outcome) return undefined;
      return { summary: outcome.summary };
    } catch {
      return undefined;
    }
  };
  return defineExtension({
    name: "fast-compaction",
    hooks: [{ task: "pi.compaction", handlers: { beforeCompact } }],
  });
}