import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode, startConversation, trackView, userEntryIds, waitForIdle } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function checkpointCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("checkpoints", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    async function settledThread(text: string) {
      const started = await startConversation(target, { text, workspace: "checkout", git: true });
      const tracker = await trackView(target.core, started.conversation.id);
      await waitForIdle(tracker);
      const [entryId] = userEntryIds(tracker.view());
      await tracker.stop();
      return { ...started, entryId: entryId as string };
    }

    test("[checkpoints] records a before and an after checkpoint per message", async () => {
      const { conversation, entryId } = await settledThread("write a file");
      const checkpoints = await target.core.conversations.checkpoints(conversation.id);
      expect(checkpoints.map((item) => item.kind)).toEqual(["before", "after"]);
      expect(checkpoints[0]?.requestId).toBe(checkpoints[1]?.requestId);
      expect(checkpoints.every((item) => item.entryId === entryId)).toBe(true);
      expect(checkpoints[1]?.files.length).toBeGreaterThan(0);
    });

    test("[checkpoints] shows a file diff and rejects unsafe paths and unknown checkpoints", async () => {
      const { conversation } = await settledThread("write a file");
      const after = (await target.core.conversations.checkpoints(conversation.id)).find(
        (item) => item.kind === "after",
      );
      const path = after?.files[0]?.path as string;
      expect(
        await target.core.conversations.checkpointDiff(conversation.id, after?.id as string, path),
      ).toContain(path);
      await rejectsWithCode(
        target.core.conversations.checkpointDiff(conversation.id, after?.id as string, "../x"),
        "invalid_request",
      );
      await rejectsWithCode(
        target.core.conversations.checkpointDiff(conversation.id, "nope", path),
        "not_found",
      );
    });

    test("[checkpoints] previews what a rewind changes", async () => {
      const { conversation, entryId } = await settledThread("write a file");
      const preview = await target.core.conversations.rewindPreview(conversation.id, entryId);
      expect(preview.changes.length).toBeGreaterThan(0);
      expect(preview.changes.every((change) => ["write", "delete"].includes(change.action))).toBe(true);
      await rejectsWithCode(target.core.conversations.rewindPreview(conversation.id, "nope"), "not_found");
    });

    test("[checkpoints] rewinds into a new thread and hands back the message", async () => {
      const { conversation, entryId } = await settledThread("write a file");
      const result = await target.core.conversations.rewind(conversation.id, entryId);
      expect(result.draft).toBe("write a file");
      expect(result.conversation.id).not.toBe(conversation.id);
      expect(result.conversation.workspace.path).toBe(conversation.workspace.path);
      expect(result.conversation.forkOf?.conversationId).toBe(conversation.id);
    });

    test("[checkpoints] refuses to rewind while a thread in the same folder runs", async () => {
      const { conversation, entryId } = await settledThread("hello");
      await target.core.conversations.send(conversation.id, {
        text: "bash sleep 30",
        requestId: "busy-send",
      });
      await rejectsWithCode(target.core.conversations.rewind(conversation.id, entryId), "thread_busy");
      await target.core.conversations.abort(conversation.id);
    });
  });
}
