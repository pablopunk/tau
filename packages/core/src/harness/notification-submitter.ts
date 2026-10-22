import type { Context, JsonValue } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable";
import { withAdmissionGate } from "./conversation-submit";
import { BACKGROUND } from "./open";

export interface Notification {
  /** The `app.*` entry kind, such as `app.monitor_event`. */
  readonly kind: string;
  readonly data: JsonValue;
  /** What the model reads. */
  readonly text: string;
  /** Pi Durable deduplicates by it, so a repeated call is a no-op. */
  readonly requestId: string;
}

export interface NotificationSubmitter {
  /** Submits one follow-up input with a custom entry. Rejects when the thread no longer exists. */
  notify(conversationId: string, notification: Notification, context?: Context): Promise<void>;
  /**
   * Appends a passive entry write. Idle threads append without starting a
   * turn; busy threads place it at the next boundary. Rejects when the
   * thread no longer exists. Only harness-backed submitters carry it: the
   * task-runtime submitter (subagent reporters) never writes.
   */
  submitWrite(conversationId: string, write: PassiveWrite, context?: Context): Promise<void>;
}

export interface PassiveWrite {
  readonly kind: string;
  readonly data: JsonValue;
  readonly model?: readonly Message[];
  /** What the model reads; the follow-up fallback path submits it when no harness backs this submitter. */
  readonly text: string;
  /** Pi Durable deduplicates by it, so a repeated call is a no-op. */
  readonly requestId: string;
}

export type OpenConversation = (
  id: ConversationId,
  context: Context,
) => Promise<Pick<Conversation, "submit"> | undefined>;

export const notificationInput = ({ kind, data, text, requestId }: Notification) =>
  ({
    type: "input",
    content: text,
    whenBusy: "followUp",
    requestId,
    entry: { kind, data },
  }) as const;

export class ThreadGoneError extends Error {
  constructor(conversationId: string) {
    super(`Thread ${conversationId} is gone`);
  }
}

/** The one place that builds notification inputs. The Harness and a task runtime both open conversations. */
export function createNotificationSubmitter(open: OpenConversation): NotificationSubmitter {
  return {
    async notify(conversationId, notification, context = BACKGROUND) {
      // Held only through the admission: `sendNow` holds the same gate across
      // its snapshot → abort → re-admit, so a notification can never steal
      // the idle slot between the abort and the re-admission.
      await withAdmissionGate(conversationId, async () => {
        const conversation = await open(Number(conversationId) as ConversationId, context);
        if (!conversation) throw new ThreadGoneError(conversationId);
        await conversation.submit(notificationInput(notification), context);
      });
    },
    async submitWrite(conversationId, write, context = BACKGROUND) {
      await withAdmissionGate(conversationId, async () => {
        const conversation = await open(Number(conversationId) as ConversationId, context);
        if (!conversation) throw new ThreadGoneError(conversationId);
        await conversation.submit(
          {
            type: "write",
            entry: {
              kind: write.kind,
              data: write.data,
              ...(write.model === undefined ? {} : { model: [...write.model] }),
            },
            requestId: write.requestId,
          } as never,
          context,
        );
      });
    },
  };
}

export const harnessNotificationSubmitter = (harness: Harness): NotificationSubmitter =>
  createNotificationSubmitter((id, context) => harness.conversation(id, context));
