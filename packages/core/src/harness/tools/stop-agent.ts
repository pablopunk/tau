import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { childIdOf, requireOwnSubagent } from "../subagent-own";
import { setStopRequested } from "../subagent-status";
import { STOP_AGENT_DESCRIPTION } from "./agent-description";
import type { ToolFileFactory } from "./tool-file";

export const StopAgentParameters = Type.Object({ id: Type.String() });

export const stopAgentToolFile: ToolFileFactory = () => ({
  implemented: true,
  extension: defineExtension({
    name: "stop-agent",
    tools: [
      defineTool({
        name: "stop_agent",
        description: STOP_AGENT_DESCRIPTION,
        parameters: StopAgentParameters,
        replay: "safe",
        execute: async ({ id }, api, context) => {
          const child = await api.commit(async (tx) => {
            const own = await requireOwnSubagent(tx, api.conversationId, id);
            await setStopRequested(tx, api.conversationId, id, true);
            return own;
          }, context);
          await (await api.conversation(childIdOf(child), context))?.abort(context);
          return {
            output: [{ type: "text", text: `Stopping subagent ${id}. A stopped notification follows.` }],
          };
        },
      }),
    ],
  }),
});
