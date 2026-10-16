# Contract changes

Phase 1 agents add a short entry here when `packages/protocol/**` or `packages/testkit/**` must change. The integrator applies the entries and clears them.

Entry format: workstream, what to change, why, the exact change.

## D (web conversation): Phase 0 shell test asserts the old stub

- What: `packages/web/src/app/App.test.tsx` expects the `<Conversation>` stub text ("Conversation shell") inside `data-testid="conversation"`.
- Why: D replaced the stub with the real conversation view, so that one assertion fails. The file belongs to workstream C, which replaces the shell and this test anyway.
- Change: drop the `toHaveTextContent("Conversation shell")` assertion (the real view shows "This conversation is no longer available." for the unknown id `shell`, or the transcript).
