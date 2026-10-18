import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { ownTimerWithId, removeTimersWhere } from "../../timers/timer-ops";
import { ConversationDoc } from "../conversation-docs";
import type { ToolFileFactory } from "./tool-file";

export const TimerDeleteParameters = Type.Object({ id: Type.String() });

export const timerDeleteToolFile: ToolFileFactory = (services) => ({
  implemented: true,
  extension: defineExtension({
    name: "timer-delete",
    tools: [
      defineTool({
        name: "timer_delete",
        description: "Delete one of this thread's timers by id (see timers_list).",
        parameters: TimerDeleteParameters,
        replay: "safe",
        execute: async ({ id }, api, context) => {
          const own = String(api.conversationId);
          const removed = await api.commit(async (tx) => {
            const { projectId } = await tx.doc(ConversationDoc, api.conversationId);
            return removeTimersWhere(tx, projectId, ownTimerWithId(id, own));
          }, context);
          if (removed.length === 0) {
            throw new Error(`${id} is not one of this thread's timers. Use timers_list to see them.`);
          }
          await services.current().timers.announce(own);
          return { output: [{ type: "text", text: `Timer ${id} deleted.` }] };
        },
      }),
    ],
  }),
});
