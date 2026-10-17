import { type ConversationId, configure, type Extension, type Tx } from "@earendil-works/pi-durable";
import { registerChildConversation } from "../conversation-child";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "../conversation-docs";
import { legacyWorkspace } from "../conversation-index";
import { isLiveChildOf } from "../subagents-prompt";

type SpawnRequest = {
  readonly taskId: string;
  readonly parentId: ConversationId;
  readonly description: string;
  readonly withoutExtension: () => Extension | undefined;
};

async function findOwnedChild(tx: Tx, taskId: string): Promise<ConversationId | undefined> {
  return (await tx.scanConversations({ ownerTaskId: taskId } as never, 1)).items[0]?.id;
}

async function parentEntry(tx: Tx, parentId: ConversationId, projectId: string) {
  const index = await tx.doc(ProjectIndexDoc, projectId, INDEX_SEED);
  return index.conversations.find((entry) => entry.conversationId === Number(parentId));
}

async function createChild(tx: Tx, request: SpawnRequest): Promise<ConversationId> {
  const created = await tx.createConversation({
    ownership: { kind: "task", taskId: request.taskId },
  } as never);
  const nested = request.withoutExtension();
  if (nested) await configure(tx, created.id, { extensions: { remove: [nested] } });
  const parent = await tx.doc(ConversationDoc, request.parentId);
  const entry = await parentEntry(tx, request.parentId, parent.projectId);
  await registerChildConversation(tx, {
    conversationId: created.id,
    parentId: String(request.parentId),
    projectId: parent.projectId,
    title: request.description,
    workspace: entry?.workspace ?? legacyWorkspace(""),
    ...(entry?.model && { model: entry.model }),
    now: Date.now(),
  });
  return created.id;
}

/** Idempotent: a rerun of the same task finds the child it already made. */
export async function findOrCreateChild(tx: Tx, request: SpawnRequest): Promise<ConversationId> {
  return (await findOwnedChild(tx, request.taskId)) ?? (await createChild(tx, request));
}

export const notMyChildMessage = (subagent: string) =>
  `Subagent ${subagent} is not one of this thread's subagents. Omit \`subagent\` to start a new one.`;

/** Fails the tool call unless `subagent` is a live child thread of `parentId`. */
export async function requireOwnChild(
  tx: Tx,
  parentId: ConversationId,
  subagent: string,
): Promise<ConversationId> {
  const parent = await tx.doc(ConversationDoc, parentId);
  const index = await tx.doc(ProjectIndexDoc, parent.projectId, INDEX_SEED);
  const found = index.conversations.some(
    (entry) => String(entry.conversationId) === subagent && isLiveChildOf(parentId)(entry),
  );
  if (!found) throw new Error(notMyChildMessage(subagent));
  return Number(subagent) as ConversationId;
}
