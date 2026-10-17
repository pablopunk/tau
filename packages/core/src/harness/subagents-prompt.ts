import type { ConversationId, PromptInput, PromptSection } from "@earendil-works/pi-durable";
import { ConversationDoc, type IndexedConversation, ProjectIndexDoc } from "./conversation-docs";

type Context = Parameters<PromptSection["render"]>[1];

export const SUBAGENTS_INTRO =
  "These are your subagents. They are persistent threads the user can open from the sidebar. Continue one with the task tool by passing its id as `subagent`.";

export function subagentLine(entry: IndexedConversation): string {
  const status = entry.status ?? "idle";
  const active = new Date(entry.lastRunEndedAt ?? entry.updatedAt).toISOString();
  return `- id ${entry.conversationId}: ${entry.title} (${status}, last activity ${active})`;
}

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
