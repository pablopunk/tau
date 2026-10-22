import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode, startConversation, summaryOf, trackView, waitForIdle } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function workspaceCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("workspaces", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    async function settledThread(text: string, workspace: "worktree" | "checkout" = "worktree") {
      const started = await startConversation(target, { text, workspace, git: true });
      const tracker = await trackView(target.core, started.conversation.id);
      await waitForIdle(tracker);
      await tracker.stop();
      return started;
    }

    test("[workspaces] defaults to worktrees and stores the message mode", async () => {
      const { core } = target;
      expect(await core.settings.get()).toMatchObject({
        messageMode: "steer",
        workspaceDefault: "per-project",
      });
      await core.settings.setWorkspaceDefault("checkout");
      await core.settings.setMessageMode("queue");
      expect(await core.settings.get()).toMatchObject({ messageMode: "queue", workspaceDefault: "checkout" });
    });

    test("[workspaces] starts a worktree thread on its own branch", async () => {
      const { project, conversation } = await startConversation(target, { workspace: "worktree", git: true });
      expect(conversation.workspace).toMatchObject({
        mode: "worktree",
        branch: expect.stringMatching(/^pi\/[a-z0-9-]+$/),
        base: expect.any(String),
        state: "ready",
        mergedSha: null,
        pullRequestUrl: null,
      });
      expect(conversation.workspace.path).not.toBe(project.path);
    });

    test("[workspaces] starts a checkout thread in the project folder", async () => {
      const { project, conversation } = await startConversation(target, { workspace: "checkout", git: true });
      expect(conversation.workspace).toMatchObject({ mode: "checkout", path: project.path, branch: null });
    });

    test("[workspaces] uses the settings default when the start input has no workspace", async () => {
      await target.core.settings.setWorkspaceDefault("checkout");
      const { conversation } = await startConversation(target, { git: true });
      expect(conversation.workspace.mode).toBe("checkout");
    });

    test("[workspaces] per-project default follows the last explicit mode of that project", async () => {
      const first = await startConversation(target, { workspace: "checkout", git: true });
      const next = await startConversation(target, { projectId: first.project.id, text: "again" });
      expect(next.conversation.workspace.mode).toBe("checkout");
      const projects = await target.core.projects.list();
      expect(projects.find((project) => project.id === first.project.id)?.lastWorkspaceMode).toBe("checkout");
    });

    test("[workspaces] per-project default is a worktree for a project with no history", async () => {
      const { conversation } = await startConversation(target, { git: true });
      expect(conversation.workspace.mode).toBe("worktree");
    });

    test("[workspaces] always uses the folder for Home", async () => {
      const { conversation } = await startConversation(target, { projectId: "home", workspace: "worktree" });
      expect(conversation.workspace.mode).toBe("checkout");
    });

    test("[workspaces] gives two worktree threads different paths and branches", async () => {
      const { project, conversation: first } = await startConversation(target, { git: true, text: "same" });
      const second = await target.core.conversations.start({
        projectId: project.id,
        text: "same",
        requestId: "second-start",
        workspace: "worktree",
      });
      expect(second.workspace.path).not.toBe(first.workspace.path);
      expect(second.workspace.branch).not.toBe(first.workspace.branch);
    });

    test("[workspaces] rejects workspace actions on a checkout thread and unknown threads", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { workspace: "checkout", git: true });
      await rejectsWithCode(core.workspaces.status(conversation.id), "invalid_request");
      await rejectsWithCode(core.workspaces.merge(conversation.id), "invalid_request");
      await rejectsWithCode(core.workspaces.status("nope"), "not_found");
    });

    test("[workspaces] reports a clean idle worktree as mergeable", async () => {
      const { conversation } = await settledThread("hello");
      expect(await target.core.workspaces.status(conversation.id)).toMatchObject({
        dirtyFiles: [],
        unmergedCommits: 0,
        canMerge: true,
        reason: null,
      });
    });

    test("[workspaces] refuses to merge while the thread runs", async () => {
      const { conversation } = await startConversation(target, { text: "bash sleep 30", git: true });
      await rejectsWithCode(target.core.workspaces.merge(conversation.id), "thread_busy");
      await target.core.conversations.abort(conversation.id);
    });

    test("[workspaces] merges while the thread runs with force", async () => {
      const { conversation } = await startConversation(target, { text: "bash sleep 30", git: true });
      const merged = await target.core.workspaces.merge(conversation.id, true);
      expect(merged.workspace.state).toBe("merged");
      await target.core.conversations.abort(conversation.id);
    });

    test("[workspaces] refuses to merge a dirty worktree", async () => {
      const { core } = target;
      const { conversation } = await settledThread("write a file");
      expect((await core.workspaces.status(conversation.id)).dirtyFiles.length).toBeGreaterThan(0);
      await rejectsWithCode(core.workspaces.merge(conversation.id), "worktree_dirty");
    });

    test("[workspaces] merges a clean worktree and records the commit", async () => {
      const { core } = target;
      const { conversation } = await settledThread("hello");
      const merged = await core.workspaces.merge(conversation.id);
      expect(merged.workspace).toMatchObject({ state: "merged", mergedSha: expect.any(String) });
      expect(await summaryOf(core, conversation)).toMatchObject({ workspace: { state: "merged" } });
    });

    test("[workspaces] creates a pull request and keeps its url", async () => {
      const { conversation } = await settledThread("hello");
      const updated = await target.core.workspaces.createPullRequest(conversation.id);
      expect(updated.workspace.pullRequestUrl).toEqual(expect.any(String));
    });

    test("[workspaces] guards removing a worktree with unmerged work unless forced", async () => {
      const { core } = target;
      const { project, conversation } = await settledThread("write a file");
      await rejectsWithCode(core.workspaces.remove(conversation.id, false), "has_unmerged_work");
      await rejectsWithCode(core.conversations.remove(conversation.id), "has_unmerged_work");
      const removed = await core.workspaces.remove(conversation.id, true);
      expect(removed.workspace).toMatchObject({ state: "removed", path: project.path });
      expect((await summaryOf(core, conversation)).workspace.state).toBe("removed");
    });

    test("[workspaces] removes a clean worktree without force and deletes a forced thread", async () => {
      const { core } = target;
      const clean = await settledThread("hello");
      expect((await core.workspaces.remove(clean.conversation.id, false)).workspace.state).toBe("removed");
      const dirty = await core.conversations.start({
        projectId: clean.project.id,
        text: "write a file",
        requestId: "dirty-start",
        workspace: "worktree",
      });
      const tracker = await trackView(core, dirty.id);
      await waitForIdle(tracker);
      await tracker.stop();
      await core.conversations.remove(dirty.id, { force: true });
      expect((await core.conversations.list(clean.project.id)).map((item) => item.id)).not.toContain(
        dirty.id,
      );
    });
  });
}
