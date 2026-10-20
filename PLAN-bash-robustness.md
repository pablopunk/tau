# PLAN: bash-tool robustness

Created 2026-10-20. Goal: a `bash` tool call can never hang forever, lie about its
outcome, kill the hub, or leak entries — no matter what pipeline shape the model runs.
Deliberately no PTY, no output-quiet/CPU stuck detection, no model-side stop tool:
industry postmortems (Claude Code, OpenCode, Codex CLI) converge on wall-clock +
process-group kill as the proven sufficient set.

## Failure catalog (all verified file:line or repro; envolves two already-known bugs)

- **Phantom background.** `background()` succeeds on an exited-but-unsettled process:
  state stays `"running"` during the 250ms pipe-drain wait
  (`running-process.ts:52,111-115` vs `process-service.ts:592-593`), so
  `Promise.race([exited, moved])` (`:575`) resolves `background`, then the row
  instantly exits+prunes. Reproduced 30/30.
- **Pipeline wedges.** `tail -f f | head -5` with too few lines (consumer waits;
  libc block-buffers when piped so the UI shows nothing) and
  `yes | (head -3; sleep 30)` (lingerer holds the read end; shell waits) never
  terminate. `stop()` kills both in ms — but nothing can invoke it mid-call:
  no default timeout, no stop-foreground route, model has no stop tool.
- **H1 — self-kill via pid 0.** `child.pid ?? 0` (`running-process.ts:59`) flows
  into `terminateGroup` → `kill(-0)` = own group (`process-group.ts:1-8`).
  `watchMemory` already guards `pid <= 0`; the stop path doesn't.
- **H6 — unbounded stop path.** `stopEntry` awaits `running.exited` with no race
  (`process-service.ts:341`); one D-state/never-reaping child hangs
  `stop()`/`stopAll`/shutdown forever. `terminateGroup` also never verifies
  post-SIGKILL (`process-group.ts:19-25`).
- **H4 — group escape.** `setsid`/double-fork grandchildren leave the `detached`
  group; single-shot SIGKILL, no tree walk, no verification.
- **H3 — slot starvation.** One wedged heavy holder parks all waiters
  (`slot-queue.ts:57-77`, `process-service.ts:459-461`); plus silent probe-only
  waits (`slot=false, probe=true`) with no honest status text.
- **H5 — output freeze.** `api.output` throw latches `waiting=false` one-way
  (`bash.ts:147-155`); suspects are turn-stop/conversation-abort and restart,
  NOT `stop_agent` (subagent-scoped).
- **H2/M3 — orphan entries.** Foreground `onExit` never prunes (`:398-406`);
  only `release()` does. `fail()`'s `wasForeground` branch orphans entry+files.
- **M4 — orphan logs by design.** `removeRecord` keeps `.log`; startup GC only
  loads `*.json` (`:541-552`).
- **M1/M2 — unbounded Linux execs.** `scopeVerdict` (`resource-support.ts:182-199`),
  `reset-failed`, `clearLeftovers`, `ps` sweep have no `timeoutMs`; verdict gates
  exit settlement (`running-process.ts:99-104`). macOS unaffected
  (`classifyExit` never wired — `usesScope` false on darwin).
- **M5/M7 — flood costs.** Quadratic tail concat + splitter re-split
  (`log-tail.ts:7-12`, `line-splitter.ts:9-14`); `log-file.ts:13-22` ignores
  `write()` backpressure.
- **M6 — `release()` awaits `entry.writes` on the tool path** (`:487` → `bash.ts:193`).
- **L1/L4 — kill-vs-exit indistinguishable; user timeout starts at admission.**
- Declared drops: L2 (notification loss on prune timeout), L3 (30s watch linger).

## Release 1 — safety + escape hatch (internal order matters)

1. **R1.1 pid guard (H1).** Guard `terminateGroup` entry on `pid <= 0`
   (covers the `groupIsAlive(0)` poll + SIGKILL, not just `signalGroup`);
   resolve silently (idempotent-stop contract). Precedent: `reapStaleAtStartup`
   already checks `pid > 0`. Test: fake spawn `pid: undefined` → `stop()` no-op.
2. **R1.2 bounded stop core (H6/H4).** Race `running.exited` with grace+buffer in
   `stopEntry` (`:329-331`); on timeout force-settle via a new **`reaping` entry state** built as explicit replication of the settle continuation (`:361-366`) inside the timeout branch — NOT via `running.exited.then`, covering both `running` and `!running` (queued waiter) cases:
   entry stays listed with pid retained, single-notification guard (no duplicate
   on late real exit), file removal deferred to real `close`/exit, **heavy slot
   released** (D-state holders burn no CPU; dead M1 holders hold nothing; the
   residual port-conflict risk is surfaced in the notification text), memory
   watch cancelled. Post-SIGKILL bounded verify poll (~1s, never blocking) that
   annotates surviving groups. Deferred `resolve()` is first-wins idempotent, so
   a late real exit's `finishEntry` must not send a second notice, and the live process must keep its pid (else unkillable-by-id via the `pruned` no-op).
3. **R1.3 bounded pre-spawn (M1/M2/H3b).** `timeoutMs` (2s, `PROBE_TIMEOUT_MS`
   standard) on every child `exec`; a **single deadline** across
   probe+retry+clearLeftovers+sweep while holding a slot; `tellWaiting` names the
   real blocker (slot position vs probe step). M7: honor `write()` return +
   dropped-bytes counter.
4. **R1.4 stop affordance (L5).** `stopToolCall(conversationId, callId)` route
   (protocol + server + service via `stopEntry`, no listing needed) + Stop button
   next to BackgroundButton for `status === "running"`. Bound the button's call
   with the same R1.2 race.
5. **R1.5 default timeout.** 120s default, 600s ceiling, explicit per-call
   override; error text states default/ceiling. Ships LAST in R1 so no legit
   build dies before the escape exists. (L4 admitted-vs-spawn skew becomes
   harmless once pre-spawn is bounded by R1.3.)

## Release 2 — settle correctness

- **R2.1 exit-aware background gate.** Set `exitSeen` synchronously in
  `error`/`exit`/`close` handlers; `background()` refuses with `not_found` when
  `exitSeen && !groupIsAlive(pid)` (shell dead, group dead: nothing to hand
  over — phantom killed). When the group still lives (pipe-holding
  grandchildren), handover still succeeds — the useful handle is preserved.
- **R2.2 DROPPED.** Consumer audit shows `bash.ts` is the only in-repo
  `runForeground` caller, so no second owner can race `background()` — and
  tracing the single-consumer interleaving shows no corruption either: if the
  exit wins the `outcome` race after `background()` passed checks, the entry
  is genuinely dead, so `release()` deleting it is the correct end state
  (dead process, no row, exit notice still sent via `notifyOnExit`). Residual
  weirdness is only a success response for an already-dead call; the R2.1
  gate shrinks that window to exit-during-`persist`.
- **R2.3 fd lifetime.** Idempotent `log.close()` at outcome settle; drop
  post-settle chunks in `handle()` (retained output already snapshotted;
  `EXIT_TAIL` already computed). Caps already bound growth; this bounds fd life.

## Release 3 — leaks & bounds

- **R3.1 single ownership (H2/M3).** Every entry reaches exactly one terminal
  state; startup GC also sweeps orphan `.log` files (M4 mechanism).
- **R3.2 log retention cap/GC per node** (count or total MB).
- **R3.3 bounded splitter/tail (M5).** Cap splitter `partial`; slice tail only
  past 2× window (or ring buffer).
- **R3.4 bound `release()` (M6).** Race `entry.writes` with a timeout on the
  tool path.
- **R3.5 H5 investigate.** Instrument turn-stop and restart paths; minimal
  handling only once the settler is named.

## Verification

Each item ships with a regression test via existing seams (`SpawnFn`,
injectable `exec`/`sweep`/`prepare`; real-spawn for pipeline shapes with
`timeout`-guarded commands; `heavySlots: 1` for queue tests). Run:
`mise exec -- pnpm --filter @tau/core exec vitest run <file>`, then package
`check` + `test`.

## Open risks (accepted)

- Reaping entries with live D-state holders remain visible until reboot; slot
  released anyway (documented conflict risk in notification).
- `setsid` escapees are annotated, not reaped (no tree walk — matches industry).
- 120s default may still bite exotic builds; data will decide tightening.
