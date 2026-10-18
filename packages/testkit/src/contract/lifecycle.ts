import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import {
  nextRequestId,
  rejectsWithCode,
  startConversation,
  summaryOf,
  trackView,
  waitFor,
  waitForIdle,
  waitForSummary,
} from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function lifecycleCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("archive and delete", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[archive] archives and unarchives, keeps the thread listed, and unarchives on send", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target);
      await core.conversations.archive(conversation.id, true);
      expect((await summaryOf(core, conversation)).archivedAt).toEqual(expect.any(Number));
      await core.conversations.archive(conversation.id, false);
      expect((await summaryOf(core, conversation)).archivedAt).toBeNull();
      await core.conversations.archive(conversation.id, true);
      await core.conversations.send(conversation.id, { text: "again", requestId: nextRequestId() });
      expect((await summaryOf(core, conversation)).archivedAt).toBeNull();
    });

    test("[archive] never stops a running thread", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "bash sleep 30" });
      await waitForSummary(core, conversation, (summary) => summary.status === "running", "running");
      await core.conversations.archive(conversation.id, true);
      expect((await summaryOf(core, conversation)).status).toBe("running");
      await core.conversations.abort(conversation.id);
    });

    test("[archive] rejects unknown threads with not_found", async () => {
      await rejectsWithCode(target.core.conversations.archive("nope", true), "not_found");
    });

    test("[delete] removes a thread everywhere, idempotently, and answers not_found afterwards", async () => {
      const { core } = target;
      const { project, conversation } = await startConversation(target);
      await core.conversations.remove(conversation.id);
      await core.conversations.remove(conversation.id);
      expect(await core.conversations.list(project.id)).toEqual([]);
      expect((await core.conversations.listAll()).map((item) => item.id)).not.toContain(conversation.id);
      await rejectsWithCode(
        core.conversations.send(conversation.id, { text: "hi", requestId: nextRequestId() }),
        "not_found",
      );
      await rejectsWithCode(core.conversations.rename(conversation.id, "x"), "not_found");
      await rejectsWithCode(
        core.conversations.retry(conversation.id, { requestId: nextRequestId() }),
        "not_found",
      );
      await rejectsWithCode(core.conversations.archive(conversation.id, true), "not_found");
      await rejectsWithCode(
        core.conversations.watch(conversation.id, async () => {}),
        "not_found",
      );
      await rejectsWithCode(core.conversations.remove("nope"), "not_found");
    });

    async function archivedWorktreeThread(text: string, projectId?: string) {
      const started = await startConversation(target, {
        text,
        projectId,
        workspace: "worktree",
        git: projectId === undefined,
      });
      const tracker = await trackView(target.core, started.conversation.id);
      await waitForIdle(tracker);
      await tracker.stop();
      await target.core.conversations.archive(started.conversation.id, true);
      return started;
    }

    test("[delete-archived] deletes clean archived threads and keeps the rest with a warning", async () => {
      const { core } = target;
      const clean = await archivedWorktreeThread("hello");
      const dirty = await archivedWorktreeThread("write a file", clean.project.id);
      const live = await startConversation(target, { text: "hello" });
      const result = await core.conversations.deleteArchived({ force: false });
      expect(result.deleted).toEqual([clean.conversation.id]);
      expect(result.kept).toEqual([{ id: dirty.conversation.id, reason: expect.stringContaining(" in ") }]);
      expect((await summaryOf(core, dirty.conversation)).unmergedWarning).toMatch(/^(Uncommitted|Unmerged)/);
      expect((await summaryOf(core, live.conversation)).unmergedWarning).toBeNull();
    });

    test("[delete-archived] force deletes threads with unmerged work", async () => {
      const { core } = target;
      const dirty = await archivedWorktreeThread("write a file");
      const result = await core.conversations.deleteArchived({ force: true });
      expect(result).toEqual({ deleted: [dirty.conversation.id], kept: [] });
      expect(await core.conversations.list(dirty.project.id)).toEqual([]);
    });

    test("[delete] ends an open watch with a retired view and stops a running thread", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "bash sleep 30" });
      const tracker = await trackView(core, conversation.id);
      await core.conversations.remove(conversation.id);
      await waitFor(() => tracker.view() === null, "the retired view");
      await tracker.stop();
    });

    test("[delete] removing a project deletes its threads", async () => {
      const { core } = target;
      const { project, conversation } = await startConversation(target);
      await core.projects.remove(project.id);
      expect((await core.conversations.listAll()).map((item) => item.id)).not.toContain(conversation.id);
      await rejectsWithCode(
        core.conversations.send(conversation.id, { text: "hi", requestId: nextRequestId() }),
        "not_found",
      );
    });
  });
}
