import type { Context, JsonValue } from "@earendil-works/chord";
import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable";
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
      const conversation = await open(Number(conversationId) as ConversationId, context);
      if (!conversation) throw new ThreadGoneError(conversationId);
      await conversation.submit(notificationInput(notification), context);
    },
  };
}

export const harnessNotificationSubmitter = (harness: Harness): NotificationSubmitter =>
  createNotificationSubmitter((id, context) => harness.conversation(id, context));
