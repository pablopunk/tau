import type { ConversationId, Tx } from "@earendil-works/pi-durable";
import { ConversationDoc, INDEX_SEED, type IndexedConversation, ProjectIndexDoc } from "./conversation-docs";
import { isLiveChildOf } from "./subagents-prompt";

export const notMySubagentMessage = (id: string) =>
  `${id} is not one of this thread's subagents. Use list_agents to see yours.`;

export async function childrenOfThread(tx: Tx, parentId: ConversationId): Promise<IndexedConversation[]> {
  const parent = await tx.doc(ConversationDoc, parentId);
  const index = await tx.doc(ProjectIndexDoc, parent.projectId, INDEX_SEED);
  return copyOutOfTransaction(index.conversations.filter(isLiveChildOf(parentId)));
}

const copyOutOfTransaction = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export async function requireOwnSubagent(tx: Tx, parentId: ConversationId, id: string) {
  const found = (await childrenOfThread(tx, parentId)).find((entry) => String(entry.conversationId) === id);
  if (!found) throw new Error(notMySubagentMessage(id));
  return found;
}

export const childIdOf = (entry: IndexedConversation) => Number(entry.conversationId) as ConversationId;
