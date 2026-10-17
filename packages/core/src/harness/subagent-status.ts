import type { ConversationId, Tx } from "@earendil-works/pi-durable";
import type { AgentStatus } from "@pi-everywhere/protocol";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "./conversation-docs";
import { SubagentRegistryDoc } from "./subagent-registry-doc";

export async function setAgentStatus(tx: Tx, childId: ConversationId, status: AgentStatus) {
  const meta = await tx.doc(ConversationDoc, childId);
  const index = await tx.doc(ProjectIndexDoc, meta.projectId, INDEX_SEED);
  const entry = index.conversations.find((candidate) => candidate.conversationId === Number(childId));
  if (entry) entry.agentStatus = status;
}

export async function setStopRequested(tx: Tx, parentId: ConversationId, childId: string, value: boolean) {
  const record = (await tx.doc(SubagentRegistryDoc, parentId)).children[childId];
  if (record) record.stopRequested = value;
}
