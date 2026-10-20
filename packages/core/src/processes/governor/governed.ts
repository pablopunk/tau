import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { ResourceSettings } from "@tau/protocol";
import { ConversationDoc, type IndexedConversation, ProjectIndexDoc } from "../../harness/conversation-docs";
import { anyControlOn } from "./resource-state";

export type ThreadClass = "main" | "worktree" | "subagent";

/** Subagent by `parentId`, else worktree by workspace mode, else main. */
export function classifyThread(entry: Pick<IndexedConversation, "parentId" | "workspace">): ThreadClass {
  if (entry.parentId !== undefined && entry.parentId !== null) return "subagent";
  return (entry.workspace?.mode ?? "checkout") === "worktree" ? "worktree" : "main";
}

const boxOf = (settings: ResourceSettings, thread: ThreadClass) =>
  thread === "subagent"
    ? settings.appliesTo.subagents
    : thread === "worktree"
      ? settings.appliesTo.worktrees
      : settings.appliesTo.main;

export const anyBoxTicked = (settings: ResourceSettings) =>
  settings.appliesTo.main || settings.appliesTo.worktrees || settings.appliesTo.subagents;

/** `find` is not called unless a control is on and at least one box is ticked. Unknown or deleted is ungoverned. */
export async function isGoverned(
  settings: ResourceSettings,
  find: () => Promise<IndexedConversation | undefined>,
): Promise<boolean> {
  if (!anyControlOn(settings) || !anyBoxTicked(settings)) return false;
  const entry = await find().catch(() => undefined);
  if (!entry || entry.deletedAt !== undefined) return false;
  return boxOf(settings, classifyThread(entry));
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
