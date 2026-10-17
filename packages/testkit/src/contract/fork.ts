import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import {
  entryKinds,
  isRunning,
  rejectsWithCode,
  startConversation,
  trackView,
  userEntryIds,
  waitFor,
  waitForIdle,
} from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const answers = (view: Parameters<typeof entryKinds>[0]) =>
  entryKinds(view).filter((kind) => kind === "pi.assistant").length;

export function forkCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("fork", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    async function twoTurnThread() {
      const started = await startConversation(target, { text: "first", git: true, workspace: "worktree" });
      const tracker = await trackView(target.core, started.conversation.id);
      await waitForIdle(tracker);
      await target.core.conversations.send(started.conversation.id, { text: "second", requestId: "second" });
      await waitFor(() => answers(tracker.view()) === 2 && !isRunning(tracker.view()), "the second answer");
      const entryIds = userEntryIds(tracker.view());
      await tracker.stop();
      return { ...started, entryIds };
    }

    test("[fork] forks from a message into a thread that shares the workspace", async () => {
      const { core } = target;
      const { project, conversation, entryIds } = await twoTurnThread();
      const fork = await core.conversations.fork(conversation.id, entryIds[0] as string);
      expect(fork.id).not.toBe(conversation.id);
      expect(fork.forkOf).toEqual({ conversationId: conversation.id, entryId: entryIds[0] });
      expect(fork.workspace.path).toBe(conversation.workspace.path);
      expect(fork.title).toMatch(/^Fork of /);
      expect((await core.conversations.list(project.id)).map((item) => item.id)).toContain(fork.id);
    });

    test("[fork] keeps only the history up to the chosen message", async () => {
      const { core } = target;
      const { conversation, entryIds } = await twoTurnThread();
      const fork = await core.conversations.fork(conversation.id, entryIds[0] as string);
      const tracker = await trackView(core, fork.id);
      expect(userEntryIds(tracker.view())).toHaveLength(1);
      expect(entryKinds(tracker.view())).toContain("pi.user");
      await tracker.stop();
    });

    test("[fork] rejects unknown threads and entries with not_found", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { git: true });
      await rejectsWithCode(core.conversations.fork("nope", "1"), "not_found");
      await rejectsWithCode(core.conversations.fork(conversation.id, "nope"), "not_found");
    });
  });
}
