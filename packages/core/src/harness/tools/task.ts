import {
  defineExtension,
  defineTool,
  type Extension,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { finalAnswerOf } from "./task-answer";
import { findOrCreateChild } from "./task-child";
import type { ToolFileFactory } from "./tool-file";

export const TaskParameters = Type.Object({ description: Type.String(), prompt: Type.String() });

const NO_ANSWER = "The subagent finished without an answer.";

export const taskToolFile: ToolFileFactory = () => {
  const task: ToolRegistration<typeof TaskParameters> = defineTool({
    name: "task",
    description:
      "Delegate a self-contained task to a subagent and get its answer. Give it a short description and a complete prompt.",
    parameters: TaskParameters,
    replay: "safe",
    executionMode: "parallel",
    execute: async (args, api, context) => {
      const childId = await api.commit(
        (tx) =>
          findOrCreateChild(tx, {
            taskId: String(api.taskId),
            parentId: api.conversationId,
            description: args.description,
            withoutExtension: () => extension,
          }),
        context,
      );
      await api.details({ conversationId: String(childId), status: "running" }, context);
      const child = await api.conversation(childId, context);
      const request = { type: "input", content: args.prompt, requestId: `task:${api.taskId}` } as const;
      const settled = await (await child?.submit(request, context))?.wait(context);
      const answer = await api.commit((tx) => finalAnswerOf(tx, childId), context);
      const status = settled?.status === "done" ? "done" : "unanswered";
      return {
        output: [{ type: "text", text: answer || NO_ANSWER }],
        details: { conversationId: String(childId), status },
      };
    },
  });
  const extension: Extension = defineExtension({ name: "task", tools: [task] });
  return { implemented: true, extension };
};
