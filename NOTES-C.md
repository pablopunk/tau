# Notes from owner C

* `create-core.ts` line 178: pass `approvals` to `createLiveWork({ harness, processes, approvals })`. The dependency is optional, so nothing breaks until then.
* Stop must call `approvals.denyAll(conversationId)` (the stop path is not mine).
* `ApprovalRequest.server` is the `claude_connector` server segment (`Linear`, `Google_Calendar`); always-allow stores `cliToolNameOf({ server, tool })`.
* `conversationOfSession` is still the stub in `create-core.ts`; unknown sessions are denied.
* Goal and timer turns need no code: they call `request` like any turn and wait, and `hasLiveWork` (once wired) keeps goal check-ins armed.
