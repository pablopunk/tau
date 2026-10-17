# Notes for the integrator (agent A)

Edits outside agent A's globs, needed so the repo compiles and `[subagents-v2]` passes in the real core:

* `harness/tools/tool-file.ts`: `ToolServices.subagents: SubagentServices` (type in `harness/subagent-services.ts`).
* `create-core.ts`: fills `subagents` with `createAgentTypeLoader()`, `resolveModelAlias` (agent B's modules), the fast model from settings, `projects.require`, and `workspaces`. Passes `harness` to `createConversationsApi`.
* `conversations-api.ts`: new dep `harness`; `createSubagentStopper(conversations, harness)`.
* `core/src/contract.test.ts`: `[subagents-v2]` removed from `PENDING_TAGS`. Still pending: `testkit/src/contract.test.ts` (fake core; needs a fake `agent` flow, not done here).

Behaviour that depends on agent B: only a `subagent_type` other than `general-purpose`/`fork` calls `agentTypes.load`, and only a `model` argument or a type model other than `inherit` calls `resolveModelAlias`. The default path works with B's stubs.

Not committed: the harness blocked git from this worktree. Changes are in the working tree.
