import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { Approvals } from "../../approvals/approvals-port";
import type { ConversationOfSession } from "../../harness/conversation-of-session";
import type { NativeEvent } from "./events";

export type NativePermissionResult =
  | { readonly behavior: "allow"; readonly updatedInput: Record<string, unknown> }
  | { readonly behavior: "deny"; readonly message: string };

export type NativeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { readonly signal: AbortSignal; readonly toolUseID: string },
) => Promise<NativePermissionResult>;

export type NativeNotice = Extract<NativeEvent, { type: "notice" }>;

export interface NativePermissionBroker {
  readonly canUseTool: NativeCanUseTool;
  /** Denies every approval this thread is waiting on. */
  denyAll(): void;
  pendingCount(): number;
}

export interface NativePermissionBrokerDeps {
  readonly approvals: Approvals;
  readonly threadId: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  /** Appends the decision to the transcript. A failure here never changes a decision. */
  readonly recordNotice: (notice: NativeNotice) => Promise<unknown>;
  /** The set of waiting approvals changed. */
  readonly onChange?: () => void;
  readonly threadExists?: () => Promise<boolean>;
}

export const ASK_USER_QUESTION_TOOL = "AskUserQuestion";
export const APPROVAL_SERVER = "Claude Code";
export const DEFAULT_PERMISSION_TIMEOUT_MS = 10 * 60 * 1000;

const READ_ONLY_TOOLS: readonly string[] = ["Read", "Glob", "Grep"];
const PATH_FIELDS: readonly string[] = ["file_path", "path", "notebook_path"];
const GLOB_FIELD_OF: Readonly<Record<string, string>> = { Glob: "pattern", Grep: "glob" };
const SUMMARY_FIELDS: readonly string[] = ["command", "file_path", "path", "pattern", "url", "description"];
const MAX_SUMMARY_LENGTH = 120;
const NATIVE_SESSION_PREFIX = "native-thread:";

const QUESTIONS_UNSUPPORTED =
  "Tau cannot show questions yet. Ask the user in plain text in your reply instead.";

export const denyEverything: NativeCanUseTool = async () => ({
  behavior: "deny",
  message: "Tau has no way to ask the user for permission here, so the tool call was denied.",
});

export const nativeApprovalSessionOf = (threadId: string): string => `${NATIVE_SESSION_PREFIX}${threadId}`;

export const withNativeThreads =
  (lookup: ConversationOfSession): ConversationOfSession =>
  async (piSessionId) =>
    piSessionId.startsWith(NATIVE_SESSION_PREFIX)
      ? piSessionId.slice(NATIVE_SESSION_PREFIX.length)
      : lookup(piSessionId);

const allow = (input: Record<string, unknown>): NativePermissionResult => ({
  behavior: "allow",
  updatedInput: input,
});

const deny = (message: string): NativePermissionResult => ({ behavior: "deny", message });

const realpathOfNearestAncestor = (path: string): string => {
  let current = path;
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
  try {
    return resolve(realpathSync(current), relative(current, path));
  } catch {
    return path;
  }
};

const realOrSelf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const isInside = (root: string, path: string): boolean => {
  const from = relative(root, path);
  return from === "" || (!from.startsWith("..") && !isAbsolute(from));
};

const staysInside = (root: string, value: unknown): boolean => {
  if (typeof value !== "string" || value.startsWith("~")) return false;
  return isInside(root, realpathOfNearestAncestor(resolve(root, value)));
};

const isRelativeWithoutParents = (value: unknown): boolean =>
  typeof value === "string" &&
  !isAbsolute(value) &&
  !value.startsWith("~") &&
  !value.split(/[\\/]/).includes("..");

export function isReadOnlyInsideWorkspace(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): boolean {
  if (!READ_ONLY_TOOLS.includes(toolName)) return false;
  const root = realOrSelf(cwd);
  const present = PATH_FIELDS.filter((field) => input[field] !== undefined);
  if (!present.every((field) => staysInside(root, input[field]))) return false;
  const globField = GLOB_FIELD_OF[toolName];
  return (
    globField === undefined || input[globField] === undefined || isRelativeWithoutParents(input[globField])
  );
}

const SECRET_ASSIGNMENT =
  /(authorization|token|secret|passw(or)?d|api[_-]?key|access[_-]?key)(["']?\s*[:=]\s*["']?)(\S+)/gi;
const BEARER = /\bbearer\s+\S+/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;

export const redactSecrets = (text: string): string =>
  text
    .replace(
      SECRET_ASSIGNMENT,
      (_all, name: string, _p, separator: string) => `${name}${separator}[redacted]`,
    )
    .replace(BEARER, "Bearer [redacted]")
    .replace(LONG_TOKEN, "[redacted]");

const firstSummaryField = (input: Record<string, unknown>): string | undefined => {
  const field = SUMMARY_FIELDS.find((name) => typeof input[name] === "string");
  return field === undefined ? undefined : `${field}: ${String(input[field])}`;
};

export function summarizeInput(input: Record<string, unknown>): string {
  const raw = firstSummaryField(input) ?? `fields: ${Object.keys(input).slice(0, 8).join(", ")}`;
  const flat = redactSecrets(raw.replace(/\s+/g, " ").trim());
  return flat.length > MAX_SUMMARY_LENGTH ? `${flat.slice(0, MAX_SUMMARY_LENGTH)}…` : flat;
}

type Outcome = "allowed" | "denied" | "timed-out" | "cancelled" | "stopped" | "removed" | "unsupported";

const OUTCOME_MESSAGES: Readonly<Record<Exclude<Outcome, "allowed">, string>> = {
  denied: "The user denied this tool call.",
  "timed-out": "No decision arrived in time, so the tool call was denied.",
  cancelled: "The run was cancelled, so the tool call was denied.",
  stopped: "The user stopped the thread, so the tool call was denied.",
  removed: "This thread was removed, so the tool call was denied.",
  unsupported: QUESTIONS_UNSUPPORTED,
};

const noticeOf = (toolUseID: string, toolName: string, input: Record<string, unknown>, outcome: Outcome) => {
  const text = `Permission ${outcome}: ${toolName} (${summarizeInput(input)})`;
  const code = outcome === "allowed" ? "permission-allowed" : "permission-denied";
  return { type: "notice", key: `permission:${toolUseID}`, code, text } satisfies NativeNotice;
};

export function createNativePermissionBroker(deps: NativePermissionBrokerDeps): NativePermissionBroker {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
  const inflight = new Map<string, Promise<NativePermissionResult>>();
  const stopped = new Set<string>();
  const changed = (): void => deps.onChange?.();

  const record = async (
    toolUseID: string,
    toolName: string,
    input: Record<string, unknown>,
    outcome: Outcome,
  ): Promise<void> => {
    try {
      await deps.recordNotice(noticeOf(toolUseID, toolName, input, outcome));
    } catch {
      /* the transcript is best effort: the decision stands */
    }
  };

  const denied = async (
    request: { toolUseID: string; toolName: string; input: Record<string, unknown> },
    outcome: Exclude<Outcome, "allowed">,
    message: string = OUTCOME_MESSAGES[outcome],
  ): Promise<NativePermissionResult> => {
    await record(request.toolUseID, request.toolName, request.input, outcome);
    return deny(message);
  };

  async function waitForUser(
    request: { toolUseID: string; toolName: string; input: Record<string, unknown> },
    signal: AbortSignal,
  ): Promise<NativePermissionResult> {
    const { toolUseID, toolName, input } = request;
    if (signal.aborted) return denied(request, "cancelled");
    if (deps.threadExists && !(await deps.threadExists())) return denied(request, "removed");
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    changed();
    try {
      const verdict = await deps.approvals.request({
        piSessionId: nativeApprovalSessionOf(deps.threadId),
        toolUseId: toolUseID,
        server: APPROVAL_SERVER,
        tool: toolName,
        arguments: input,
        signal: AbortSignal.any([signal, timeout.signal]),
      });
      if (timeout.signal.aborted) return await denied(request, "timed-out");
      if (signal.aborted) return await denied(request, "cancelled");
      if (stopped.has(toolUseID)) return await denied(request, "stopped");
      if (!verdict.allowed) return await denied(request, "denied", verdict.message);
      await record(toolUseID, toolName, input, "allowed");
      return allow(input);
    } finally {
      clearTimeout(timer);
      changed();
    }
  }

  const forget = (toolUseID: string): void => {
    stopped.delete(toolUseID);
    inflight.delete(toolUseID);
  };

  const canUseTool: NativeCanUseTool = (toolName, input, { signal, toolUseID }) => {
    if (toolName === ASK_USER_QUESTION_TOOL) return denied({ toolUseID, toolName, input }, "unsupported");
    if (isReadOnlyInsideWorkspace(toolName, input, deps.cwd)) return Promise.resolve(allow(input));
    const existing = inflight.get(toolUseID);
    if (existing) return existing;
    const waiting = waitForUser({ toolUseID, toolName, input }, signal).finally(() => forget(toolUseID));
    inflight.set(toolUseID, waiting);
    return waiting;
  };

  return {
    canUseTool,
    denyAll() {
      for (const toolUseID of inflight.keys()) stopped.add(toolUseID);
      deps.approvals.denyAll(deps.threadId);
    },
    pendingCount: () => inflight.size,
  };
}
