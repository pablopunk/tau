import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { ResourcePriority, ResourceScope, ResourceSettings } from "@tau/protocol";
import { ConversationDoc, type IndexedConversation, ProjectIndexDoc } from "../../harness/conversation-docs";
import { anyControlOn } from "./resource-state";

export type ThreadClass = ResourceScope;

/** Subagent by `parentId`, else worktree by workspace mode, else main. */
export function classifyThread(entry: Pick<IndexedConversation, "parentId" | "workspace">): ThreadClass {
  if (entry.parentId !== undefined && entry.parentId !== null) return "subagent";
  return (entry.workspace?.mode ?? "checkout") === "worktree" ? "worktree" : "main";
}

export const levelOf = (settings: ResourceSettings, thread: ThreadClass): ResourcePriority =>
  settings.levels[thread];

export const anyScopeOn = (settings: ResourceSettings) =>
  settings.levels.main !== "off" || settings.levels.worktree !== "off" || settings.levels.subagent !== "off";

/**
 * The calling thread's scope when resource control applies to it, else `undefined`.
 * `find` is not called unless a control is on for at least one scope. Unknown or deleted is ungoverned.
 */
export async function governedScope(
  settings: ResourceSettings,
  find: () => Promise<IndexedConversation | undefined>,
): Promise<ThreadClass | undefined> {
  if (!anyControlOn(settings) || !anyScopeOn(settings)) return undefined;
  const entry = await find().catch(() => undefined);
  if (!entry || entry.deletedAt !== undefined) return undefined;
  const thread = classifyThread(entry);
  return levelOf(settings, thread) === "off" ? undefined : thread;
}

/** `find` is not called unless a control is on for at least one scope. Unknown or deleted is ungoverned. */
export async function isGoverned(
  settings: ResourceSettings,
  find: () => Promise<IndexedConversation | undefined>,
): Promise<boolean> {
  return (await governedScope(settings, find)) !== undefined;
}

/** The calling thread's entry in its project index. */
export function indexEntryOfCall(api: ToolExecutionApi, context: Context) {
  return async (): Promise<IndexedConversation | undefined> => {
    const meta = await api.snapshot(ConversationDoc, api.conversationId, context);
    if (!meta?.projectId) return undefined;
    const index = await api.snapshot(ProjectIndexDoc, meta.projectId, context);
    const id = Number(api.conversationId);
    return index?.conversations.find((entry) => entry.conversationId === id);
  };
}
