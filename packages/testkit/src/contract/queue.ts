import { type ConversationView, type InboxState, readLive } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import {
  nextRequestId,
  rejectsWithCode,
  startConversation,
  trackView,
  waitFor,
  waitForFast,
} from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const inboxOf = (view: ConversationView | null) =>
  (view?.docs["pi.inbox"] as InboxState | undefined)?.items ?? [];

const toBase64 = (text: string) => Buffer.from(text).toString("base64");

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

    async function queuedIds(tracker: { view(): ConversationView | null }) {
      await waitFor(() => inboxOf(tracker.view()).length > 0, "the queued message");
      return inboxOf(tracker.view()).map((item) => String(item.id));
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
      expect(await core.conversations.cancelQueued(conversation.id, itemId)).toMatchObject({
        cancelled: true,
      });
      await waitFor(() => inboxOf(tracker.view()).length === 0, "the queue to empty");
      expect(await core.conversations.cancelQueued(conversation.id, itemId)).toMatchObject({
        cancelled: false,
      });
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

    test("[queue] duplicate requestIds return the existing receipt", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      const requestId = nextRequestId();
      const first = await core.conversations.send(conversation.id, {
        text: "later",
        requestId,
        whenBusy: "followUp",
      });
      const second = await core.conversations.send(conversation.id, {
        text: "changed text, same id",
        requestId,
        whenBusy: "followUp",
      });
      expect(second).toEqual(first);
      expect(first.submissionId).toEqual(expect.any(Number));
      await waitFor(() => inboxOf(tracker.view()).length === 1, "exactly one queued message");
      await tracker.stop();
      await core.conversations.abort(conversation.id);
    });

    test("[queue] queued messages carry their normalized entry kind", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      await core.conversations.send(conversation.id, {
        text: "later",
        requestId: nextRequestId(),
        whenBusy: "followUp",
      });
      await waitFor(() => inboxOf(tracker.view()).length === 1, "the queued message");
      expect(readLive(tracker.view() as ConversationView).queued).toMatchObject([
        { entryKind: "pi.user", text: "later" },
      ]);
      await tracker.stop();
      await core.conversations.abort(conversation.id);
    });

    test("[queue] [send-now] delivers the chosen item and returns the others for restoration", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      await core.conversations.send(conversation.id, {
        text: "first",
        requestId: nextRequestId(),
        whenBusy: "followUp",
      });
      await core.conversations.send(conversation.id, {
        text: "second",
        requestId: nextRequestId(),
        whenBusy: "followUp",
      });
      await waitFor(() => inboxOf(tracker.view()).length === 2, "both queued messages");
      const items = inboxOf(tracker.view());
      const secondId = String(items.find((item) => queuedText(item) === "second")?.id);
      const result = await core.conversations.sendNow(conversation.id, secondId);
      expect(result.submissionId).toEqual(expect.any(Number));
      expect(result.restored).toEqual([{ text: "first", files: [] }]);
      await waitFor(() => inboxOf(tracker.view()).length === 0, "the queue to drain");
      await tracker.stop();
      await core.conversations.abort(conversation.id);
    });

    test("[queue] [send-now] rejects unknown and notification items", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      await core.conversations.send(conversation.id, {
        text: "later",
        requestId: nextRequestId(),
        whenBusy: "followUp",
      });
      await core.conversations.updateTodos(conversation.id, {
        requestId: nextRequestId(),
        todos: [{ content: "a todo", status: "pending" as const }],
      });
      await waitFor(() => inboxOf(tracker.view()).length === 2, "the notification to queue");
      const notificationId = String(
        inboxOf(tracker.view()).find((item) => queuedText(item).includes("todos"))?.id,
      );
      await rejectsWithCode(core.conversations.sendNow(conversation.id, "999999"), "not_found");
      await rejectsWithCode(core.conversations.sendNow(conversation.id, notificationId), "invalid_request");
      await tracker.stop();
      await core.conversations.abort(conversation.id);
    });

    test("[queue] [cancel-restore] cancel returns the queued user item for composer restoration", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      await core.conversations.send(conversation.id, {
        text: "later",
        requestId: nextRequestId(),
        whenBusy: "followUp",
      });
      const [itemId] = await queuedIds(tracker);
      const result = await core.conversations.cancelQueued(conversation.id, itemId as string);
      expect(result).toEqual({ cancelled: true, restored: [{ text: "later", files: [] }] });
      await tracker.stop();
      await core.conversations.abort(conversation.id);
    });

    test("[queue] [cancel-refs] cancel returns staged FileRefs of the queued item", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      const ref = await core.uploads.stage({
        name: "notes.txt",
        mimeType: "text/plain",
        data: toBase64("hello"),
      });
      await core.conversations.send(conversation.id, {
        text: "read this",
        files: [ref],
        requestId: nextRequestId(),
        whenBusy: "followUp",
      });
      const [itemId] = await queuedIds(tracker);
      const result = await core.conversations.cancelQueued(conversation.id, itemId as string);
      expect(result.cancelled).toBe(true);
      expect(result.restored).toHaveLength(1);
      expect(result.restored[0]?.text).toBe("read this");
      expect(result.restored[0]?.files).toMatchObject([{ name: "notes.txt", path: ref.path }]);
      await tracker.stop();
      await core.conversations.abort(conversation.id);
    });

    test("[queue] [mode-switch] switches a queued item between steer and queue in place", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      await core.conversations.send(conversation.id, {
        text: "later",
        requestId: nextRequestId(),
        whenBusy: "followUp",
      });
      // Tight poll throughout: the fake core's busy window is milliseconds, so a 10ms
      // sleep between polls could let the run drain the queue before an observation lands.
      await waitForFast(() => inboxOf(tracker.view()).length === 1, "the queued message");
      const before = inboxOf(tracker.view())[0];
      const itemId = String(before?.id);
      expect(await core.conversations.setQueuedMode(conversation.id, itemId, "steer")).toEqual({
        switched: true,
      });
      await waitForFast(() => inboxOf(tracker.view())[0]?.mode === "steer", "the mode to switch");
      // The switch is in place: the submission id (and inbox position) is preserved.
      expect(inboxOf(tracker.view())).toHaveLength(1);
      expect(inboxOf(tracker.view())[0]?.id).toBe(before?.id);
      expect(await core.conversations.setQueuedMode(conversation.id, itemId, "followUp")).toEqual({
        switched: true,
      });
      await waitForFast(() => inboxOf(tracker.view())[0]?.mode === "followUp", "the mode to switch back");
      expect(inboxOf(tracker.view())[0]?.id).toBe(before?.id);
      // Already in the desired mode: converged, still switched.
      expect(await core.conversations.setQueuedMode(conversation.id, itemId, "followUp")).toEqual({
        switched: true,
      });
      await tracker.stop();
      await core.conversations.abort(conversation.id);
    });

    test("[queue] [mode-switch] reports switched false once the item delivered", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      await core.conversations.send(conversation.id, {
        text: "later",
        requestId: nextRequestId(),
        whenBusy: "followUp",
      });
      const [itemId] = await queuedIds(tracker);
      await core.conversations.abort(conversation.id);
      await waitFor(() => inboxOf(tracker.view()).length === 0, "the queue to drain");
      expect(await core.conversations.setQueuedMode(conversation.id, itemId as string, "steer")).toEqual({
        switched: false,
      });
      await tracker.stop();
    });

    test("[queue] [mode-switch] rejects unknown, notification and foreign items", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      await core.conversations.send(conversation.id, {
        text: "later",
        requestId: nextRequestId(),
        whenBusy: "followUp",
      });
      await core.conversations.updateTodos(conversation.id, {
        requestId: nextRequestId(),
        todos: [{ content: "a todo", status: "pending" as const }],
      });
      await waitFor(() => inboxOf(tracker.view()).length === 2, "the notification to queue");
      const notificationId = String(
        inboxOf(tracker.view()).find((item) => queuedText(item).includes("todos"))?.id,
      );
      await rejectsWithCode(
        core.conversations.setQueuedMode(conversation.id, "999999", "steer"),
        "not_found",
      );
      await rejectsWithCode(
        core.conversations.setQueuedMode(conversation.id, notificationId, "steer"),
        "invalid_request",
      );
      const other = await startConversation(target, {
        text: "bash sleep 30",
        projectId: conversation.projectId,
      });
      const [itemId] = await queuedIds(tracker);
      await rejectsWithCode(
        core.conversations.setQueuedMode(other.conversation.id, itemId as string, "steer"),
        "not_found",
      );
      await tracker.stop();
      await core.conversations.abort(conversation.id);
      await core.conversations.abort(other.conversation.id);
    });

    test("[queue] [cancel-validation] cancel rejects notification items and foreign items", async () => {
      const { core } = target;
      const { conversation, tracker } = await busyThread();
      await core.conversations.updateTodos(conversation.id, {
        requestId: nextRequestId(),
        todos: [{ content: "a todo", status: "pending" as const }],
      });
      const [notificationId] = await queuedIds(tracker);
      await rejectsWithCode(
        core.conversations.cancelQueued(conversation.id, notificationId as string),
        "invalid_request",
      );
      const other = await startConversation(target, {
        text: "bash sleep 30",
        projectId: conversation.projectId,
      });
      await rejectsWithCode(
        core.conversations.cancelQueued(other.conversation.id, notificationId as string),
        "not_found",
      );
      await tracker.stop();
      await core.conversations.abort(conversation.id);
      await core.conversations.abort(other.conversation.id);
    });
  });
}

function queuedText(item: { content?: unknown } | { entry?: unknown }): string {
  const content = (item as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null ? String((part as { text?: unknown }).text ?? "") : "",
    )
    .join("");
}
