# Notes for the integrator (agent A, workspaces)

1. `create-core.ts`: pass `runGh: deps.runGh` and `announce: (projectId) => changes.emit({ resource: "conversations", projectId })` to `createWorkspaceService`. Without `runGh`, Create PR answers `github_unavailable`. (In `integrator.patch`.)
2. `contract.test.ts`: remove `"workspaces"` from `PENDING_TAGS`. All 14 `[workspaces]` cases pass with the patch.
3. The PR case needs a GitHub-looking `origin` on contract repos and a fake `gh pr create` answer. `integrator.patch` has both: `paths.gitDirectory` adds a bare origin with `pushInsteadOf` for `https://github.com/me/<name>.git`, and `test-support/fake-run-gh.ts` answers `pr create` with a URL. Apply with `git apply packages/core/src/workspaces/integrator.patch`, then delete the patch file.
4. Web mount points (not mine): render `<WorkspaceChip conversationId>` in the thread header extras; render `<WorktreeToggle projectId value onChange>` after the project picker in the new-thread composer and send `workspace` in the start input.
5. `Project` has no `isGit` flag. The toggle uses `project.kind === "git"`. A project that is a subfolder of a repo but has `kind: "folder"` gets no toggle even though core would make a worktree for it; the project summary should expose a real git flag.
6. Worktree creation records a per-request file in `<home>/worktrees/<repo>/.requests/` for retry idempotency.
7. Checkpoint refs and process logs cleanup stay with their own services; `onConversationRemoved` here only removes the worktree and branch (`branch -D`).
