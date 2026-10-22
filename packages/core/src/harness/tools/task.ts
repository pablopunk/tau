import {
  defineExtension,
  defineTool,
  type Extension,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { withAdmissionGate } from "../conversation-submit";
import { finalAnswerOf } from "./task-answer";
import { findOrCreateChild, requireOwnChild } from "./task-child";
import type { ToolFileFactory } from "./tool-file";

export const TaskParameters = Type.Object({
  description: Type.String(),
  prompt: Type.String(),
  subagent: Type.Optional(Type.String()),
});

export const TASK_DESCRIPTION =
  "Delegate a self-contained task to a subagent and get its answer. Give it a short description and a complete prompt. Each subagent is a persistent thread the user can open from the sidebar. Without `subagent`, a new subagent starts. To continue an earlier one, pass its id as `subagent`; the prompt is sent to it as a new message and it keeps its context.";

const NO_ANSWER = "The subagent finished without an answer.";

type Callers = NonNullable<ToolRegistration["callers"]>;

export const buildTaskToolFile =
  (callers?: Callers): ToolFileFactory =>
  () => {
    const task: ToolRegistration<typeof TaskParameters> = defineTool({
      name: "task",
      description: TASK_DESCRIPTION,
      parameters: TaskParameters,
      replay: "safe",
      executionMode: "parallel",
      ...(callers && { callers }),
      execute: async (args, api, context) => {
        const childId = await api.commit(
          (tx) =>
            args.subagent === undefined
              ? findOrCreateChild(tx, {
                  taskId: String(api.taskId),
                  parentId: api.conversationId,
                  description: args.description,
                  withoutExtension: () => extension,
                })
              : requireOwnChild(tx, api.conversationId, args.subagent),
          context,
        );
        await api.details({ conversationId: String(childId), status: "running" }, context);
        // Child submits go through the gate keyed by the target child conversation.
        const settled = await withAdmissionGate(String(childId), async () => {
          const child = await api.conversation(childId, context);
          const request = { type: "input", content: args.prompt, requestId: `task:${api.taskId}` } as const;
          return (await child?.submit(request, context))?.wait(context);
        });
        const answer = await api.commit((tx) => finalAnswerOf(tx, childId), context);
        const status = settled?.status === "done" ? "done" : "unanswered";
        return {
          output: [{ type: "text", text: answer || NO_ANSWER }],
          details: { conversationId: String(childId), status, continued: args.subagent !== undefined },
        };
      },
    });
    const extension: Extension = defineExtension({ name: "task", tools: [task] });
    return { implemented: true, extension };
  };

/** The model no longer sees `task`; a call already in flight still replays through the tools-only registration. */
export const taskToolFile = buildTaskToolFile(["tools"]);
