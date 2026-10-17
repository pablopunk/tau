import type { ConversationView, InboxState } from "@pi-everywhere/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode, startConversation, trackView, waitFor } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const inboxOf = (view: ConversationView | null) =>
  (view?.docs["pi.inbox"] as InboxState | undefined)?.items ?? [];

export function queueCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("queue", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    async function busyThread() {
      const started = await startConversation(target, { text: "bash sleep 30" });
      const tracker = await trackView(target.core, started.conversation.id);
      return { ...started, tracker };
    }

    test("[queue] queues a message sent with whenBusy followUp and cancels it", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      await core.conversations.send(conversation.id, {
        text: "later",
        requestId: "queued-1",
        whenBusy: "followUp",
      });
      await waitFor(() => inboxOf(tracker.view()).length === 1, "the queued message");
      const itemId = String(inboxOf(tracker.view())[0]?.id);
      expect(await core.conversations.cancelQueued(conversation.id, itemId)).toEqual({ cancelled: true });
      await waitFor(() => inboxOf(tracker.view()).length === 0, "the queue to empty");
      expect(await core.conversations.cancelQueued(conversation.id, itemId)).toEqual({ cancelled: false });
      await tracker.stop();
      await core.conversations.abort(conversation.id);
    });

    test("[queue] follows the message mode setting when the send input has no whenBusy", async () => {
      const { core } = target;
      await core.settings.setMessageMode("queue");
      const { conversation, tracker } = await busyThread();
      await core.conversations.send(conversation.id, { text: "later", requestId: "queued-2" });
      await waitFor(() => inboxOf(tracker.view()).length === 1, "the queued message");
      expect(inboxOf(tracker.view())[0]).toMatchObject({ mode: "followUp" });
      await tracker.stop();
      await core.conversations.abort(conversation.id);
    });

    test("[queue] rejects cancelling on an unknown thread with not_found", async () => {
      await rejectsWithCode(target.core.conversations.cancelQueued("nope", "1"), "not_found");
    });
  });
}
