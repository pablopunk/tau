import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { AppError } from "@pi-everywhere/protocol";
import { Type } from "typebox";
import { requireOwnSubagent } from "../subagent-own";
import { subagentServicesOf } from "../subagent-services";
import { MERGE_AGENT_DESCRIPTION } from "./agent-description";
import type { ToolFileFactory } from "./tool-file";

export const MergeAgentParameters = Type.Object({ id: Type.String() });

export const stillRunningMessage = (id: string) =>
  `Subagent ${id} is still running. Wait for its notification, then call merge_agent again.`;

export const conflictMessage = (id: string) =>
  `Merging subagent ${id} hit conflicts and nothing was merged. Use send_message to ask subagent ${id} to rebase onto the base branch and resolve the conflicts, wait for its notification, then call merge_agent again.`;

export function mergeFailure(id: string, error: unknown): Error {
  if (!(error instanceof AppError)) return error as Error;
  return new Error(error.code === "merge_conflict" ? conflictMessage(id) : error.message);
}

export const mergedMessage = (id: string, base: string | null, sha: string | null) =>
  `Merged subagent ${id} into ${base ?? "the base branch"}${sha ? ` at ${sha}` : ""}.`;

export const mergeAgentToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "merge-agent",
    tools: [
      defineTool({
        name: "merge_agent",
        description: MERGE_AGENT_DESCRIPTION,
        parameters: MergeAgentParameters,
        replay: "unsafe",
        execute: async ({ id }, api, context) => {
          const child = await api.commit((tx) => requireOwnSubagent(tx, api.conversationId, id), context);
          if (child.agentStatus === "running") throw new Error(stillRunningMessage(id));
          const { workspaces } = subagentServicesOf(services);
          const merged = await workspaces.merge(id).catch((error: unknown) => {
            throw mergeFailure(id, error);
          });
          const text = mergedMessage(id, merged.workspace.base, merged.workspace.mergedSha);
          return { output: [{ type: "text", text }] };
        },
      }),
    ],
  }),
});
