import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { AppError } from "@tau/protocol";
import { Type } from "typebox";
import { requireOwnSubagent } from "../subagent-own";
import { subagentServicesOf } from "../subagent-services";
import { forgetChild } from "../subagent-status";
import { REMOVE_AGENT_DESCRIPTION } from "./agent-description";
import type { ToolFileFactory } from "./tool-file";

export const RemoveAgentParameters = Type.Object({
  ids: Type.Array(Type.String(), { minItems: 1 }),
  force: Type.Optional(Type.Boolean()),
});

export const stillRunningRemoveMessage = (id: string) =>
  `Subagent ${id} is still running. Call stop_agent first, wait for its notification, then call remove_agent again.`;

export const unmergedRemoveMessage = (id: string, reason: string) =>
  `Subagent ${id} was not removed: ${reason} Call merge_agent first, or call remove_agent again with force true to discard that work.`;

export const removedMessage = (id: string) => `Removed subagent ${id}.`;

const failureText = (id: string, error: unknown) => {
  if (error instanceof AppError && error.code === "has_unmerged_work") {
    return unmergedRemoveMessage(id, error.message);
  }
  return error instanceof Error ? error.message : String(error);
};

export const removeAgentToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "remove-agent",
    tools: [
      defineTool({
        name: "remove_agent",
        description: REMOVE_AGENT_DESCRIPTION,
        parameters: RemoveAgentParameters,
        replay: "unsafe",
        execute: async ({ ids, force }, api, context) => {
          const { removeSubagent } = subagentServicesOf(services);
          const removeOne = async (id: string): Promise<string> => {
            try {
              const child = await api.commit((tx) => requireOwnSubagent(tx, api.conversationId, id), context);
              if (child.agentStatus === "running") return stillRunningRemoveMessage(id);
              await removeSubagent(id, force === true);
              await api.commit((tx) => forgetChild(tx, api.conversationId, id), context);
              return removedMessage(id);
            } catch (error) {
              return failureText(id, error);
            }
          };
          const lines: string[] = [];
          for (const id of new Set(ids)) lines.push(await removeOne(id));
          return { output: [{ type: "text", text: lines.join("\n") }] };
        },
      }),
    ],
  }),
});
