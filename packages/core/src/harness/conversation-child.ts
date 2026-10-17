import type { ConversationId, Tx } from "@earendil-works/pi-durable";
import type { ModelRef, ThreadWorkspace } from "@pi-everywhere/protocol";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "./conversation-docs";

export type ChildAgentInfo = {
  readonly type: string;
  readonly model: ModelRef;
  readonly background: boolean;
};

export type ChildConversation = {
  readonly conversationId: ConversationId;
  readonly parentId: string;
  readonly projectId: string;
  readonly title: string;
  readonly workspace: ThreadWorkspace;
  readonly model?: ModelRef;
  readonly agent?: ChildAgentInfo;
  readonly now: number;
};

/** For a subagent child: call it in the same tx as `tx.createConversation`, which has no `init`. */
export async function registerChildConversation(tx: Tx, child: ChildConversation): Promise<void> {
  const meta = await tx.doc(ConversationDoc, child.conversationId);
  meta.projectId = child.projectId;
  meta.title = child.title;
  meta.titleSource = "user";
  const index = await tx.doc(ProjectIndexDoc, child.projectId, INDEX_SEED);
  index.conversations.push({
    conversationId: Number(child.conversationId),
    title: child.title,
    createdAt: child.now,
    updatedAt: child.now,
    status: "running",
    parentId: child.parentId,
    workspace: child.workspace,
    ...(child.model && { model: child.model }),
    ...(child.agent && {
      agentType: child.agent.type,
      agentModel: child.agent.model,
      agentStatus: "running" as const,
      background: child.agent.background,
    }),
  });
}
