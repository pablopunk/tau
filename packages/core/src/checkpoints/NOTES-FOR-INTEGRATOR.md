# Notes for the integrator (agent B: checkpoints, fork, rewind)

1. `create-core.ts`: add `status.onRunEnded((id) => checkpoints.snapshotAfter(id, ""))` after `checkpoints` is created. The tracker has the new `onRunEnded(listener)` method. Without the line, "after" checkpoints are still taken lazily (on `list`, `diff`, `preview`, and before the next send while idle), but they can then include edits made after the run.
2. `contract.test.ts`: `"checkpoints"` and `"fork"` are already removed from `PENDING_TAGS` in this branch (all 8 cases pass).
3. `conversations-mvp5-api.ts`: `fork` and `rewind` create a thread but do not emit `{ resource: "conversations", projectId }`. Emit it there. The web works without it (it invalidates `["conversations"]` itself).
4. `web/src/conversation/Transcript.tsx`: render `<TurnChanges conversationId entryId />` (from `./checkpoints/TurnChanges`) after the last assistant item of each turn; `entryId` is the turn's user entry id. It renders nothing for turns without file changes.
5. Workspaces (agent A): a fork shares the source thread's worktree (`workspace` is copied). `unmergedWork` and `onConversationRemoved` must not remove a worktree that another live thread still uses.
6. `ConversationForker` gained `harness`, `messageText`, `entryOfRequest`, `onForked`; the checkpoint service uses them (so `CheckpointDeps` did not change).
7. `rewind` busy check lists the threads of the same project only (`conversations.list(projectId)`); a different project pointing at the same folder is not checked.
