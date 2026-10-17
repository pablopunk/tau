# Notes for the integrator (agent C)

* `packages/core/src/contract.test.ts`: remove `"subagents"` from `PENDING_TAGS`. The tag passes (verified locally, then reverted because the file is not mine).
* Child archive and delete with the parent already works through 0c's removal hooks and the contract cases.
* Sidebar nesting (indent, "Subagents (n)" collapse, status avatar) is already in `sidebar/ThreadTree.tsx` and `ThreadRow.tsx` from 0b, so `sidebar/subagents/**` has no new code.
* `task` details are `{ conversationId, status }`; there is no "last tool" field yet.
* The faux `task <description>` trigger now makes a real child; the child's prompt equals its description.
