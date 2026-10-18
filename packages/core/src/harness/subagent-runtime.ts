import {
  type ConversationId,
  configure,
  defineExtension,
  type Extension,
  type ToolExecutionApi,
  type ToolRegistration,
  type Tx,
} from "@earendil-works/pi-durable";
import type { ModelRef, ThreadWorkspace } from "@tau/protocol";
import { type ChildAgentInfo, registerChildConversation } from "./conversation-child";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "./conversation-docs";
import { legacyWorkspace } from "./conversation-index";
import { Anchor } from "./subagent-anchor";
import { SubagentRegistryDoc } from "./subagent-registry-doc";
import { Reporter } from "./subagent-reporter";
import { setAgentStatus } from "./subagent-status";

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
  readonly tools?: readonly ToolRegistration[];
  readonly workspace?: ThreadWorkspace;
  readonly foreground?: boolean;
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
    workspace: spec.workspace ?? entry?.workspace ?? legacyWorkspace(""),
    ...(spec.model && { model: spec.model }),
    agent: spec.agent,
    now: Date.now(),
  });
}

function agentChange(spec: ChildSpec) {
  const removal = spec.withoutExtension ? { extensions: { remove: [spec.withoutExtension] } } : {};
  return {
    ...removal,
    model: spec.agent.model,
    ...(spec.tools && { tools: spec.tools }),
    ...(spec.instructions && { instructions: spec.instructions }),
    ...(spec.workspace && { cwd: spec.workspace.path }),
  };
}

async function createChild(tx: Tx, parentId: ConversationId, spec: ChildSpec) {
  const anchor = await tx.createTask(Anchor, null, BACKGROUND_TASK);
  const created = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
  await configure(tx, created.id, agentChange(spec));
  await registerChild(tx, parentId, created.id, spec);
  return created.id;
}

async function recordStarted(tx: Tx, api: ToolExecutionApi, childId: ConversationId, spec: ChildSpec) {
  const registry = await tx.doc(SubagentRegistryDoc, api.conversationId);
  registry.byCall[api.callId] = String(childId);
  registry.children[String(childId)] = { reported: [] };
  if (spec.foreground) return;
  const input = { childId, message: spec.prompt, followUp: false };
  registry.reporters[api.callId] = await tx.createTask(Reporter, input, BACKGROUND_TASK);
}

/** One more message to an own child: clears a stale stop, marks it running, starts a reporter. Once per call id. */
export async function startReporter(
  api: ToolExecutionApi,
  context: CallContext,
  input: { childId: ConversationId; message: string; followUp: boolean },
): Promise<void> {
  await api.commit(async (tx) => {
    const registry = await tx.doc(SubagentRegistryDoc, api.conversationId);
    if (registry.reporters[api.callId] !== undefined) return;
    const record = registry.children[String(input.childId)];
    if (record) record.stopRequested = false;
    registry.reporters[api.callId] = await tx.createTask(Reporter, input, BACKGROUND_TASK);
    await setAgentStatus(tx, input.childId, "running");
  }, context);
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

async function lastEntryBeforeCall(tx: Tx, conversationId: ConversationId, callId: string) {
  const entries = (await tx.scanEntries({ conversationId }, 500)).items;
  const callIds = entries.filter((entry) => JSON.stringify(entry).includes(callId)).map((e) => Number(e.id));
  const cut = callIds.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...callIds);
  const before = entries.filter((entry) => Number(entry.id) < cut);
  return before.reduce((last, entry) => (Number(entry.id) > Number(last.id) ? entry : last)).id;
}

/**
 * `subagent_type: "fork"`: one commit, like `startBackgroundChild`, but the child starts with the parent's history
 * up to the entry before the calling tool call (`tx.forkConversation`).
 */
export function startForkedBackgroundChild(
  api: ToolExecutionApi,
  context: CallContext,
  spec: ChildSpec,
): Promise<ConversationId> {
  return api.commit(async (tx) => {
    const existing = (await tx.doc(SubagentRegistryDoc, api.conversationId)).byCall[api.callId];
    if (existing !== undefined) return Number(existing) as ConversationId;
    const at = await lastEntryBeforeCall(tx, api.conversationId, api.callId);
    const anchor = await tx.createTask(Anchor, null, BACKGROUND_TASK);
    const fork = await tx.forkConversation(api.conversationId, at, {
      ownership: { kind: "task", taskId: anchor },
    });
    await configure(tx, fork.id, agentChange(spec));
    await registerChild(tx, api.conversationId, fork.id, spec);
    await recordStarted(tx, api, fork.id, spec);
    return fork.id;
  }, context);
}
