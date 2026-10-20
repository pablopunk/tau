# Core notes (Phase 2)

Nothing was typechecked, tested or built: `node_modules` is missing in this worktree and the machine is CPU-starved.
Run `check`, `test`, `build` first in integration; expect small type or Biome-ordering fixes.

## api.snapshot with ProjectIndexDoc
Not confirmed by `tsc`. Static evidence: `ToolExecutionApi extends DocumentReader = Pick<Session, "snapshot" | ...>`
and `Session.snapshot` has the overload `(token: SessionDocFamilyToken<T, I>, key: string, context)`
(pi-durable 1.3.0 `types.d.ts:153,796,836`, read from a sibling checkout). `ProjectIndexDoc` is `scope: "session", family: true`.
Used in `processes/governor/governed.ts`.

## Deviations / decisions
- New optional `ProcessDeps`: `resources`, `nodeId`, `spawn`, `exec`, `sweep`, `support`, `prepare` (test seams). The two test-support files needed no change.
- `ProcessService` gained `resourceSettings`, `setResources`, `resourceSupport`, `resourceActivity`, `stopResourceCommand`.
  Tools read `processes.resourceSettings()` (sync) then `isGoverned(...)`; the lookup runs only when a control is on and a box is ticked.
- `ForegroundRun.stop(reason?)` (process-types.ts, a file I own now).
- `createSettingsApi` got an optional `resources` dep (support/activity/stop); absent = Phase 1 stubs.
- Slot handle `promise` resolves `false` when cancelled while waiting (plan said only "cancel removes").
- A queued entry that is stopped ends in state `exited`; a backgrounded entry whose spawn fails ends `killed` with a notification.
- Linux probe first success reads `memory.max` through `sh -c cat ...` with `MemoryMax=64M`; later probes run `true`.
- Unit node id = first 12 hex of sha256(nodeId) (fixed length).
- Memory stop with a sampler: `stopRequested` is set true plus `stopReason: "memory"`; `process_start` still sends an exit notification for memory stops.
- `settings-api.ts` `UNSUPPORTED_RESOURCES` stub is still the fallback.

## Not done / for the integrator
- `monitor` memory stop sends no special ended message (only the stop is applied).
- No platform-gated real tests (Linux scope oom-kill, macOS setsid kill) were written.
- No bash.ts test for abort-while-queued / timeout-not-counting-queue-time was written (logic is in `guard`).
- Apply-to classification tests (`governed.ts`) were not written.
