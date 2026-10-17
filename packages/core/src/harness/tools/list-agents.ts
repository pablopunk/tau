import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import type { IndexedConversation } from "../conversation-docs";
import { childrenOfThread } from "../subagent-own";
import { LIST_AGENTS_DESCRIPTION } from "./agent-description";
import { modelName } from "./agent-models";
import type { ToolFileFactory } from "./tool-file";

export const ListAgentsParameters = Type.Object({});

export const NO_SUBAGENTS = "You have no subagents.";

const hasWorktree = (entry: IndexedConversation) =>
  entry.workspace?.mode === "worktree" && entry.workspace.state !== "removed";

export function describeSubagent(entry: IndexedConversation) {
  return {
    id: String(entry.conversationId),
    description: entry.title,
    type: entry.agentType ?? "task",
    model: entry.agentModel ? modelName(entry.agentModel) : null,
    status: entry.agentStatus ?? entry.status ?? "idle",
    lastActivity: new Date(entry.lastRunEndedAt ?? entry.updatedAt).toISOString(),
    worktree: hasWorktree(entry) ? (entry.workspace?.path ?? null) : null,
  };
}

export const listAgentsToolFile: ToolFileFactory = () => ({
  implemented: true,
  extension: defineExtension({
    name: "list-agents",
    tools: [
      defineTool({
        name: "list_agents",
        description: LIST_AGENTS_DESCRIPTION,
        parameters: ListAgentsParameters,
        replay: "safe",
        execute: async (_args, api, context) => {
          const children = await api.commit((tx) => childrenOfThread(tx, api.conversationId), context);
          const agents = children.map(describeSubagent);
          const text = agents.length === 0 ? NO_SUBAGENTS : JSON.stringify(agents, null, 2);
          return { output: [{ type: "text", text }], details: { agents } };
        },
      }),
    ],
  }),
});
