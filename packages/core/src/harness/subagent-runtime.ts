import {
  type ConversationId,
  configure,
  defineExtension,
  type Extension,
  type ToolExecutionApi,
  type Tx,
} from "@earendil-works/pi-durable";
import type { ModelRef } from "@pi-everywhere/protocol";
import { type ChildAgentInfo, registerChildConversation } from "./conversation-child";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "./conversation-docs";
import { legacyWorkspace } from "./conversation-index";
import { Anchor } from "./subagent-anchor";
import { SubagentRegistryDoc } from "./subagent-registry-doc";
import { Reporter } from "./subagent-reporter";

export { Anchor, Reporter, SubagentRegistryDoc };

/** Carries the task definitions, so pending anchors and reporters resume after a restart. Always installed. */
export const subagentRuntimeExtension: Extension = defineExtension({
  name: "subagent-runtime",
  tasks: [Anchor, Reporter],
});

type CallContext = Parameters<ToolExecutionApi["commit"]>[1];

export type ChildSpec = {
  readonly description: string;
  readonly prompt: string;
  readonly agent: ChildAgentInfo;
  readonly model?: ModelRef;
  readonly withoutExtension?: Extension;
  readonly instructions?: string;
};

const BACKGROUND_TASK = { ownership: { kind: "conversation" }, background: true } as const;

async function registerChild(tx: Tx, parentId: ConversationId, childId: ConversationId, spec: ChildSpec) {
  const parent = await tx.doc(ConversationDoc, parentId);
  const index = await tx.doc(ProjectIndexDoc, parent.projectId, INDEX_SEED);
  const entry = index.conversations.find((candidate) => candidate.conversationId === Number(parentId));
  await registerChildConversation(tx, {
    conversationId: childId,
    parentId: String(parentId),
    projectId: parent.projectId,
    title: spec.description,
    workspace: entry?.workspace ?? legacyWorkspace(""),
    ...(spec.model && { model: spec.model }),
    agent: spec.agent,
    now: Date.now(),
  });
}

async function createChild(tx: Tx, parentId: ConversationId, spec: ChildSpec) {
  const anchor = await tx.createTask(Anchor, null, BACKGROUND_TASK);
  const created = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
  const removal = spec.withoutExtension ? { extensions: { remove: [spec.withoutExtension] } } : {};
  await configure(tx, created.id, {
    ...removal,
    ...(spec.instructions && { instructions: spec.instructions }),
  });
  await registerChild(tx, parentId, created.id, spec);
  return created.id;
}

async function recordStarted(tx: Tx, api: ToolExecutionApi, childId: ConversationId, spec: ChildSpec) {
  const registry = await tx.doc(SubagentRegistryDoc, api.conversationId);
  registry.byCall[api.callId] = String(childId);
  registry.children[String(childId)] = { reported: [] };
  const input = { childId, message: spec.prompt, followUp: false };
  registry.reporters[api.callId] = await tx.createTask(Reporter, input, BACKGROUND_TASK);
}

/**
 * One commit: anchor, child, index entry, registry entry keyed by the tool call id, and the first reporter.
 * A rerun of the same call returns the child it already made and starts nothing.
 */
export function startBackgroundChild(
  api: ToolExecutionApi,
  context: CallContext,
  spec: ChildSpec,
): Promise<ConversationId> {
  return api.commit(async (tx) => {
    const existing = (await tx.doc(SubagentRegistryDoc, api.conversationId)).byCall[api.callId];
    if (existing !== undefined) return Number(existing) as ConversationId;
    const childId = await createChild(tx, api.conversationId, spec);
    await recordStarted(tx, api, childId, spec);
    return childId;
  }, context);
}

async function newestEntryId(tx: Tx, conversationId: ConversationId) {
  const page = await tx.scanEntries({ conversationId }, 500);
  return page.items.reduce((last, entry) => (Number(entry.id) > Number(last.id) ? entry : last)).id;
}

/**
 * `subagent_type: "fork"`: one commit, like `startBackgroundChild`, but the child starts with the parent's history
 * up to its newest entry (`tx.forkConversation`).
 */
export function startForkedBackgroundChild(
  api: ToolExecutionApi,
  context: CallContext,
  spec: ChildSpec,
): Promise<ConversationId> {
  return api.commit(async (tx) => {
    const existing = (await tx.doc(SubagentRegistryDoc, api.conversationId)).byCall[api.callId];
    if (existing !== undefined) return Number(existing) as ConversationId;
    const at = await newestEntryId(tx, api.conversationId);
    const anchor = await tx.createTask(Anchor, null, BACKGROUND_TASK);
    const fork = await tx.forkConversation(api.conversationId, at, {
      ownership: { kind: "task", taskId: anchor },
    });
    await registerChild(tx, api.conversationId, fork.id, spec);
    await recordStarted(tx, api, fork.id, spec);
    return fork.id;
  }, context);
}
