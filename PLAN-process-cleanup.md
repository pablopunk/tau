# Plan: auto-remove finished background processes from the list

## Problem
`Background processes` sheet shows every past process (`Exited` / `Stopped`), growing into a giant list. Exit output is already delivered to the agent via `<process-exit>` / monitor `ended` notifications, so keeping finished rows is noise.

## Scope
- `core/processes/process-service.ts`: prune finished entries (natural exit AND stopped/killed) from memory + delete pid/log files, emit `processes` change so UI refreshes.
- `testkit/fake/fake-processes.ts`: mirror the same behavior so fake + contract stay consistent.
- Update contract + unit tests that assert finished processes stay listed (`process-service.test.ts`, `testkit/contract/processes.ts`).
- No protocol change (`ProcessInfo` states unchanged). No REST change. Web UI needs no change once `list()` only returns running (chip/sheet already handle empty).

## Behavior (v2, after adversarial review)
1. Natural exit (`stopRequested=false`): send exit/monitor-ended notification first, then prune. Prune awaits `entry.delivery` so `<process-exit>`/`ended` is queued before `entries.delete`; sets `entry.removed=true` BEFORE any final write so a trailing `save()` cannot resurrect the pid file; then `entries.delete`, `files.remove(id)` (pid + log), tombstone add, `emitChange`.
2. `stop()` (user, timeout, noisy, reap): same prune path after `running.exited`. `stop()` stays idempotent via a bounded tombstone set (500 ids): pruned id → no-op success; never-seen id → `not_found` (typo detection preserved). `stopAll`/timeout/noisy reuse `stopEntry` + await prune.
3. `logs(id)` on a pruned id: `not_found` (exit tail / streamed monitor lines already live in the thread notifications). Documented behavior change.
4. `reapStaleAtStartup`: kills live groups, sends monitor restart notices directly, then `files.remove` + tombstone. No `killed` rows are resurrected; no `emitChange` needed (nothing was ever listed this run).
5. `onConversationRemoved`: unchanged semantics (deletes everything); pruned ids of the conversation are dropped from the tombstone map to bound memory.
6. Foreground runs: unchanged (never listed until `background()`).
7. Disk: both pid record and log file are deleted on prune (plain + monitor). Monitor post-mortem is the streamed `monitor-event` history in the thread, same as before for the agent.
8. Fake (`testkit/fake/fake-processes.ts`): `kill()` deletes + tombstones instead of marking `killed`; `stop` mirrors real semantics (entry → delete, tombstoned → no-op, unknown → `not_found`); `killAll` deletes.

## Open questions for reviewer
- Should `stop()` on unknown id stay `not_found`, or become no-op? Proposal: unknown stays `not_found`, but recently-pruned ids are remembered briefly as tombstones to keep idempotency. Simpler alternative: `stop()` always no-ops on missing id — but that hides typos from the agent. Which?
- Should `logs()` on pruned id return empty string instead of `not_found`? Proposal: keep `not_found` (exit tail is in the notification).
- Should monitors that end also delete logs immediately, or keep log file for debugging? Proposal: delete both pid + log, same as plain processes.

## Files owned (if parallel agents were used)
- Owner A: `packages/core/src/processes/*`
- Owner B: `packages/testkit/src/fake/*`, `packages/testkit/src/contract/*`
- Integrator merges, no check/test/build per user request (CPU overloaded).
