import type { ConversationId, PromptInput, PromptSection } from "@earendil-works/pi-durable";
import { ConversationDoc, type IndexedConversation, ProjectIndexDoc } from "./conversation-docs";

type Context = Parameters<PromptSection["render"]>[1];

export const SUBAGENTS_INTRO =
  "These are your subagents. They are persistent threads the user can open from the sidebar. Continue one with send_message (pass its id as `to`), stop it with stop_agent, delete finished ones with remove_agent, and see them all with list_agents. Their reports arrive as notifications: do not poll.";

const activeAt = (entry: IndexedConversation) =>
  new Date(entry.lastRunEndedAt ?? entry.updatedAt).toISOString();

function agentDetails(entry: IndexedConversation): string {
  if (entry.agentType === undefined) return `${entry.status ?? "idle"}, last activity ${activeAt(entry)}`;
  const model = entry.agentModel
    ? `${entry.agentModel.provider}/${entry.agentModel.modelId}`
    : "default model";
  const level = entry.agentThinking ? ` · ${entry.agentThinking}` : "";
  return `${entry.agentType}, ${model}${level}, ${entry.agentStatus ?? "running"}, last activity ${activeAt(entry)}`;
}

export const subagentLine = (entry: IndexedConversation) =>
  `- id ${entry.conversationId}: ${entry.title} (${agentDetails(entry)})`;

export function subagentsPrompt(children: readonly IndexedConversation[]): string | undefined {
  return children.length === 0 ? undefined : [SUBAGENTS_INTRO, ...children.map(subagentLine)].join("\n");
}

export const isLiveChildOf = (parentId: ConversationId | string) => (entry: IndexedConversation) =>
  entry.parentId === String(parentId) && entry.deletedAt === undefined;

export async function renderSubagentsSection(input: PromptInput, context: Context) {
  const meta = await input.read.snapshot(ConversationDoc, input.conversationId, context);
  if (!meta?.projectId) return undefined;
  const index = await input.read.snapshot(ProjectIndexDoc, meta.projectId, context);
  return subagentsPrompt((index?.conversations ?? []).filter(isLiveChildOf(input.conversationId)));
}
