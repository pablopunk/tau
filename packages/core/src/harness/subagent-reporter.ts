import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantEntry, type ConversationId, defineTask } from "@earendil-works/pi-durable";
import type { SubagentNotificationData } from "@tau/protocol";
import { ConversationDoc } from "./conversation-docs";
import { createNotificationSubmitter } from "./notification-submitter";
import { subagentNotification } from "./subagent-notification";
import { SubagentRegistryDoc } from "./subagent-registry-doc";
import { setAgentStatus } from "./subagent-status";

export type ReporterInput = { childId: ConversationId; message: string; followUp: boolean };
type ReporterState = { phase: "deliver" } | { phase: "report"; notification?: SubagentNotificationData };

function textOf(message: AssistantMessage | undefined): string {
  return (message?.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/** Delivers one message to a child, waits for the answer, then posts one notification to the parent. */
export const Reporter = defineTask<ReporterInput, ReporterState, null>({
  name: "app.subagent-reporter",
  version: 1,
  initial: () => ({ phase: "deliver" }),
  phases: {
    deliver: async (reporter, runtime, taskContext) => {
      const { childId, message, followUp } = reporter.input;
      const child = (await runtime.conversation(childId, taskContext))!;
      const request = { type: "input", content: message, whenBusy: followUp ? "followUp" : "steer" } as const;
      const submission = await child.submit(
        { ...request, requestId: `subagent:${reporter.id}` },
        taskContext,
      );
      const settled = await submission.wait(taskContext);
      await runtime.commit(async (tx) => {
        const next = async (notification?: SubagentNotificationData) => {
          if (notification) await setAgentStatus(tx, childId, notification.status);
          return { status: "running", checkpoint: { phase: "report", notification } } as const;
        };
        const record = (await tx.doc(SubagentRegistryDoc, runtime.conversationId)).children[String(childId)]!;
        const title = (await tx.doc(ConversationDoc, childId)).title;
        const base = { childId: String(childId), title };
        if (settled.status === "unanswered") {
          if (settled.reason === "aborted") {
            return next(
              record.stopRequested ? { ...base, status: "stopped", report: "Stopped." } : undefined,
            );
          }
          return next({ ...base, status: "failed", report: String(settled.reason) });
        }
        if (settled.type !== "input" || record.reported.includes(settled.answer)) return next();
        record.reported.push(settled.answer);
        const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0] as AssistantMessage;
        return next({ ...base, status: "done", report: textOf(answer) });
      }, taskContext);
    },
    report: async (reporter, runtime, taskContext) => {
      const { notification } = reporter.state.checkpoint;
      if (notification !== undefined) {
        const submitter = createNotificationSubmitter((id, context) => runtime.conversation(id, context));
        await submitter.notify(
          String(runtime.conversationId),
          subagentNotification(notification, `subagent:${reporter.id}`),
          taskContext,
        );
      }
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        taskContext,
      );
    },
  },
  abort: (_reporter, runtime, taskContext) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext),
});
