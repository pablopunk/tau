import { AppError, type ConversationSummary } from "@tau/protocol";

export type ConversationRemovedHook = (conversation: ConversationSummary) => Promise<void>;
export type ProjectRemovedHook = (projectId: string) => Promise<void>;

export interface RemovalHooks {
  /** Descriptions of work that deleting the thread would lose (uncommitted files, unmerged commits). */
  readonly unmergedWork: (conversation: ConversationSummary) => Promise<string[]>;
  readonly onConversationRemoved: readonly ConversationRemovedHook[];
  readonly onProjectRemoved: readonly ProjectRemovedHook[];
}

export async function requireNoLostWork(
  hooks: RemovalHooks,
  conversation: ConversationSummary,
  force: boolean,
): Promise<void> {
  if (force || conversation.parentId !== null) return;
  const lost = await hooks.unmergedWork(conversation);
  if (lost.length > 0) {
    throw new AppError("has_unmerged_work", `This thread has unmerged work: ${lost.join(", ")}`);
  }
}

export async function runConversationRemoved(
  hooks: RemovalHooks,
  conversation: ConversationSummary,
): Promise<void> {
  for (const hook of hooks.onConversationRemoved) await hook(conversation);
}

export async function runProjectRemoved(hooks: RemovalHooks, projectId: string): Promise<void> {
  for (const hook of hooks.onProjectRemoved) await hook(projectId);
}

export interface ConversationRemovedParts {
  readonly terminals: ConversationRemovedHook;
  readonly claudeCliThread: ConversationRemovedHook;
  readonly processes: ConversationRemovedHook;
  readonly workspace: ConversationRemovedHook;
  readonly checkpoints: ConversationRemovedHook;
  readonly goals: ConversationRemovedHook;
  readonly timers: ConversationRemovedHook;
}

export function conversationRemovedInOrder(
  parts: ConversationRemovedParts,
): readonly ConversationRemovedHook[] {
  return [
    parts.terminals,
    parts.claudeCliThread,
    parts.processes,
    parts.workspace,
    parts.checkpoints,
    parts.goals,
    parts.timers,
  ];
}
