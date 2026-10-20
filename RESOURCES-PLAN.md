# Resource control for agent commands (plan) — v8 (APPROVED, round 7)

v7 answers review round 6 (5 items, marked **[R6-n]**) and turns **Apply to** into three checkboxes (user decision: main checkout threads, worktree threads, subagents). v8 folds in round 7's minor items **[R7-n]** and is approved. v6 answered round 5 (7 items, **[R5-n]**) and added Apply to. v5 answered round 4 (**[R4-n]**), v4 round 3 (**[R3-n]**). v3 answered round 2 (**[R2-n]**), v2 round 1 (**[R1-n]**).

## Problem

Several threads in parallel, each in its own worktree, each running tests, builds or typechecks, saturate one node's
CPU and RAM. The machine stutters and the user cannot use the computer. Nothing caps what a thread runs today.

## Goals

- Opt-in, per node, in the existing settings panel. **Off by default; with it off, behavior is today's** (proved by tests).
- Host-native, close to zero overhead: no VM, no container, no file I/O penalty, no `node_modules` reinstall.
- Linux and macOS.
- Three independent controls: **priority** (agent commands get a smaller CPU share), **concurrency** (only K heavy
  foreground commands at once, the rest queue), **memory** (a runaway command is stopped before it freezes the machine).
- **"Off" means all three are off** (`priority: "off"`, `heavySlots: null`, `memoryLimitMb: null`). Each control works
  alone; a partial setting is valid and only the controls that are on have any effect **[R2-6]**.
- **Apply to (v7):** three checkboxes choose which threads are governed: **Main checkout threads** (default off),
  **Worktree threads** (default off), **Subagents** (default on). A thread not ticked runs its commands at full speed,
  ungoverned, and never queues. Subagents are classified by being a subagent, not by where they run.

## Non-goals

- MCP stdio server processes started via `mcp_call` (`mcp/mcp-connection.ts:16`) are not governed **[R7-3]**.
- Security isolation, credentials, network policy (OpenShell and nono evaluated: not a fit, see PLAN.md). Containers and
  VMs. Windows.
- Governing the user's terminal panes, tau's own process, or tau's `execFile` plumbing (git, gh).
- Hard per-thread CPU caps. IO priority **[R1-12]** (the `io` controller is not delegated, schedulers are `none`).
- A max-hold timeout for slots, rerunning failed wrapped commands, `process_start`/monitor queueing.

## Evidence

macOS (8P + 4E cores), fixed work, machine otherwise idle: normal 5.5 s (12 procs) / 3.6 s (4);
`taskpolicy -c utility` 14.9 s (2.7x); `taskpolicy -b` 105.5 s (19x) / 34.8 s (9.6x, 4 procs). Verified by the
reviewer: `taskpolicy -c utility /bin/bash -c 'echo $$'` prints the spawned pid, pgid = pid, group SIGTERM kills it, exit
and signal-derived codes propagate; a missing program gives rc 66, a bad clamp rc 64.

Linux (Debian 13, 4 CPUs, cgroup v2, no root): `cpu memory pids` delegated; `CPUQuota`, live `set-property`,
`MemoryMax`, `setsid` containment, 18 ms spawn overhead verified.

**Priority on Linux [R1-1, R2-10].** `systemd-run --scope` puts commands in `app.slice`, a sibling of the user's
`session-N.scope`, so `CPUWeight` does not rank against a terminal. Plain `nice`/`chrt` in the same cgroup do, and
`sched_autogroup` does not neutralise them (a competitor in `session-122.scope` vs a `setsid`-started command): `nice -n 19`
5.75 s vs 0.34 s, `chrt -i 0` 5.95 s vs 0.34 s, `nice -n 5` 4.52 s vs 1.49 s. So **Balanced `nice -n 5` is a ~25% share, not
"yields strongly"**; the UI says "lower priority", never "yields". Priority yields only to processes in the same cgroup as
tau; if tau runs as a systemd service the user's session is elsewhere (Phase 0 spike 5 decides how to detect that from
`/proc/self/cgroup`, and the UI line states the limitation without detection until it is measured).

**OOM facts [R1-4, R2-1].** `MemoryMax` overrun ends the scope with SIGTERM (143) via `OOMPolicy=stop`; SIGKILL (137) only if
the command was `exec`ed. The scope ends `ActiveState=failed Result=oom-kill`. `--collect` garbage-collects that failed unit
and `Result` reads back `success`, so **`--collect` is not used**. The kill happens in ~140 ms, so polling `memory.events`
at 500 ms saw zeros; it is not a detector. `memory.events` disappears when the scope exits.

## The setting

Per node, `settings.json` key `resources`, one object written whole, validated per field in `parseStored` **[R1-9]**:

```ts
ResourceSettings = {
  priority: "off" | "balanced" | "background";  // default "off"
  heavySlots: number | null;                     // null = unlimited (default). 1..64
  memoryLimitMb: number | null;                  // null = none (default). >= 64. per command process tree
  appliesTo: { main: boolean; worktrees: boolean; subagents: boolean };  // default { false, false, true }
}
```

| Priority | macOS | Linux |
|---|---|---|
| balanced | `taskpolicy -c utility <shell> -c cmd` | `nice -n 5 <shell> -c cmd` |
| background | `taskpolicy -b <shell> -c cmd` | `chrt -i 0 <shell> -c cmd` (inline fallback to `nice -n 19`, see below) |

**Linux `background` wrapper [R6-3].** `chrt` can be missing or refused (containers), and there is no rerun, so the wrapper
carries its own fallback (verified on vibemachine: pid, exit code and group kill preserved, policy `SCHED_IDLE`, fallback ran
under `nice` 19 with rc 3 when `chrt` was forced to fail):
`/bin/sh -c 'chrt -i 0 true 2>/dev/null && exec chrt -i 0 "$@" || exec nice -n 19 "$@"' _ <shell> -c CMD`. `wrap-command`
emits exactly this for `background` on Linux; a test covers the fallback branch.

No cgroup scope is used for priority. A scope is used **only** for the memory limit on Linux with cgroup support:
`systemd-run --user --scope --quiet --unit=tau-<nodeId>-<entryId> -p MemoryMax=<n>M -p MemorySwapMax=0 -- <prio prefix> <shell> -c cmd`.
The unit name carries the node id so two tau processes of one user never clear each other's failed units; entry ids are
unique, so `--unit` never collides **[R3-4]**. Binaries are resolved to absolute paths once (macOS `/usr/sbin/taskpolicy`;
Linux: a **synchronous** PATH scan with `fs.accessSync` on the first governed command, with `/usr/bin` and `/bin` added when PATH is short; never a spawned `command -v`, so Off stays lazy), because a launchd- or GUI-started tau can have `PATH=/usr/bin:/bin` **[R3-5]**.

**Memory kill detection (Linux scope) [R2-1, R3-4]:** after the command exits, `systemctl --user show tau-<nodeId>-<entryId>.scope
-p Result,ActiveState`. If `ActiveState` is not `failed` or `inactive` (systemd has not settled yet), retry for up to 200 ms
before concluding. `Result=oom-kill` means a memory stop, and the message is built from that, never from the exit code. A
user Stop (external SIGKILL) reads `Result=success` and never as a memory stop (verified). Then
`systemctl --user reset-failed tau-<nodeId>-<entryId>.scope`. On the first governed spawn after tau starts, run
`systemctl --user reset-failed 'tau-<nodeId>-*.scope'` once (glob verified; a no-match call exits 0) to clear units a crash
left behind. Lazy, so Off never runs it.

**Memory (Linux basic, macOS):** polled sampler, see `memory-watch`.

## What it applies to

Every command passes `launch()` in `processes/process-service.ts`: `bash` (`runForeground`), `process_start`, monitors.
Claude CLI threads reach it because tau exposes its tools to the SDK as `mcp__tau__*` (foundation re-confirms in `claude-cli/`).

| Control | bash | process_start | monitor |
|---|---|---|---|
| Priority | yes | yes | yes |
| Memory limit | yes | yes | yes |
| Heavy slots | yes, if heavy | **never** | never |

**Apply to [v7, R6-1, R6-2].** Classification of a conversation: **subagent** if `ConversationSummary.parentId !== null`
(`protocol/src/entities.ts:275`; verified: `agent` and `task` children set `parentId` (`task` children have no `agentType`, so
the rule is `parentId`, never `agentType`), user forks set only `forkOf`, goals cannot be children); otherwise **worktree** if
`workspace.mode === "worktree"`, else **main** (`workspace.mode === "checkout"`). A subagent of a worktree thread is a subagent;
the worktree thread itself is a worktree thread. A command is governed when the box for its class is ticked.
**[R7-1] Lookup API:** `ToolServices` has no conversation store. The tools use what the code already does: `api.snapshot(ConversationDoc, api.conversationId, context)` for the project id (`mcp-project.ts:6`), then `snapshot(ProjectIndexDoc, projectId, context)` and match `IndexedConversation.parentId` / `.workspace` (precedent: `subagents-prompt.ts:34`, `timers-prompt.ts:19`). `workspace` is optional on the index entry, so the rule is `entry.workspace?.mode ?? "checkout"`; entries with `deletedAt` or no index entry are ungoverned. `process-start.ts` and `monitor.ts` have `execute(args, api)` with no `context`: add the third parameter, as `bash.ts` does. **First step for the core agent: confirm with `tsc` that `api.snapshot` accepts `ProjectIndexDoc`** (not verifiable in the review worktree: no `node_modules`). Cost is one project-index read per candidate command, paid only when a control is on and a box is ticked.
**There is no sync thread lookup** (every thread read is async: `conversation-store.ts:161,170`). So classification happens at
**tool level**: `bash.ts`, `process-start.ts` and `monitor.ts` are already async; each reads the sync `resource-state` first and,
only when a control is on and at least one box is ticked, awaits the conversation summary, classifies, and passes
`governed: boolean` in `ForegroundRequest` / `StartProcessRequest`. Off (or no control on) pays nothing: no lookup. An unknown
id counts as ungoverned (fail-safe). `createProcessService` stays sync and just honours `governed`. A command with
`governed: false` takes the sync path with `wrap = null` and no slot, exactly like Off. There is therefore **no `isSubagent`
dep and no cache**. Ungoverned commands never appear in `resourceActivity`, and a main thread waiting on a governed subagent
is not a slot holder, so there is no queue deadlock. Slots are shared by all governed commands node-wide. In the UI the Apply
to row is disabled while all three controls are off (it would have no effect).

Only foreground `bash` takes a slot **[R1-2, R1-7]**. Cost: a model that runs `pnpm test` through `process_start` bypasses
the queue; stated in the setting's description.

## Design

### Governor (`processes/governor/`, small files)

- `resource-state.ts`: current `ResourceSettings` in memory, loaded at startup, replaced by `setResources`. `launch()` reads
  it **synchronously**; Off adds no await and no file read **[R1-8]**.
- `wrap-command.ts` (pure): `(settings, support, shell, command) -> { file, args } | null`. Null when no control that needs
  wrapping is on. Must exec the shell so the spawned pid is the group leader.
- `heavy-command.ts` (pure): split on `&&`, `||`, `;`, `|`, newline; skip env assignments and wrappers (`time`, `env`, `npx`,
  `pnpm exec`, `mise exec --`, `pnpm --filter <x>`, `pnpm -r`, `-C dir`); heavy if a segment starts with a known runner
  (`vitest run`, `jest`, `playwright test`, `pytest`, `tsc`, `biome check`, `eslint`, `cargo build|test|check|clippy`,
  `go build|test`, `gradle`, `mvn`, `make`, `docker build`) or a package-manager script named or containing `test`, `build`,
  `check`, `lint`, `typecheck`, `e2e`. **Never heavy** if the segment has `--watch`, `-w`/`--watch` as a flag, `--watchAll`,
  `--ui`, `watch`, `:watch`, `dev`, `serve`, `start`. Known fail-open case: `pnpm -w test` (workspace root) matches the `-w`
  rule and is not heavy; in the test table with a note **[R2-9]**. Unknown is not heavy.
- `slot-queue.ts`: FIFO counting semaphore, node-wide, one per `createProcessService`. `acquire(label) -> { promise, cancel }`.
  `cancel()` on a pending waiter removes it; on a **granted-but-unconsumed** slot it releases it **[R2-2]**. Release is
  idempotent. `setLimit(n | null)`: raising or `null` wakes waiters at once, lowering never kills. `snapshot()` returns
  `{ holders, waiting }` with entry ids, conversation ids, a truncated command and `since`, for the Resources panel only.
- `memory-watch.ts`: one shared timer (**every 2 s**, and the first sweep only after a command has run for 2 s, so short
  commands cost nothing) while any limited non-scope process exists **[R4-9]**. Per sweep one
  `LC_ALL=C ps -axo pid=,ppid=,pgid=,rss=,lstart=` (30-50 ms at ~1100 procs, measured; `lstart` adds nothing) **[R3-6]**.
  `lstart` is parsed as the **last 5 tokens** (C locale: `Thu Oct 15 10:25:50 2026`); resolution is 1 s, so a pid reused
  within the same second as its predecessor is not caught (documented). **[R4-3] One format only:** both the stored start
  time and the pre-signal re-check use `LC_ALL=C ps -o lstart=` on both platforms (string vs string, whitespace collapsed because single-digit days are space-padded); no
  `/proc/<pid>/stat` ticks, so nothing needs converting through `btime`. **[R5-5]** `ps -p` costs 20-30 ms per call on macOS (about a whole sweep), so **one fresh sweep is taken immediately before each kill batch and signals come from it**; `-p` is only for a single stray pid (gone pid = empty output, rc 1 = "gone"). Test: pid reuse with a different `lstart`. Members = descendants by ppid ancestry plus pgid
  **plus a sticky set of pids seen in earlier sweeps** (each stored with its start time), so reparented children and
  double-forked daemons stay tracked as long as they were seen once **[R2-5]**. Not covered: a daemon that double-forks and
  reparents between two sweeps (documented). **After the root shell exits the watch continues until every sticky member is
  gone or 30 s have passed**, whichever comes first; a daemon that outlives that is no longer limited (documented)
  **[R3-6]**. Kill: TERM then, after grace, KILL, each signal sent to a pid only after
  re-checking its start time against the stored one, so a reused pid is never signalled. **Latency [R5-7]:** first signal comes after 4 s or more (first sweep at 2 s, then two sweeps, plus the grace period); the sweep drops to 1 s once any member's RSS passes 50% of the limit. A hog allocating several GB per second can still freeze a small machine first, so the UI says "Best effort, checked every 2 s"; only the Linux scope is a kernel limit. Over-limit rule: two consecutive
  sweeps, or one sweep over 1.5x the limit. macOS metric (RSS over-counts shared and under-counts compressed memory, `footprint`
  is ~60 ms per pid): decided in Phase 0 spike 2, with `footprint` only as a confirm-before-kill read. Linux basic: the sweep
  uses RSS from `ps` (already in the sweep); PSS from `/proc/<pid>/smaps_rollup` (1.9 ms per large process, too costly for
  every member every sweep) is only the confirm-before-kill read **[R4-4]**.
- `resource-support.ts`: **lazy** (never at startup; only when `resourceSupport()` is called, or before a spawn **that has a
  Linux memory limit set** — slots-only or priority-only settings need no cgroup and never probe) **[R2-6, R3-3]**.
  Before such a spawn, a cheap probe runs with a **TTL of 5 s**, a **2 s timeout**, **one shared in-flight probe** for
  concurrent spawns, a **unique** unit name `tau-probe-<nodeId>-<random>` (random suffix, never a counter that restarts) run with `--collect` (the probe needs no `Result`; a fixed name made back-to-back
  probes fail with "already loaded" for ~0.5 s, a unique name cannot collide, so no retry; a retry exists only for a probe that timed out). A test asserts unit names match `[a-zA-Z0-9:_.\-]` **[R4-5, R5-6]**, and the same environment commands get
  (`XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS` from tau's env, `/run/user/<uid>` filled in when absent): a real
  `systemd-run --user --scope -- true`, and a read-back of `memory.max` on first success. Output
  `{ platform, cgroupMemory, prioritySupported }`. **No output-sniffing and no rerun [R2-4].** If the probe fails the governor
  marks itself degraded: **exactly one command fails on the transition**, with one explicit message ("Resource limits unavailable: <reason>. Fix or
  turn them off in Settings → Resources."), and later commands use the basic wrapper while a background re-probe (every 30 s) watches for recovery. A wrapper failure after a passing
  probe (a race) simply surfaces systemd-run's own stderr as the command's output.
- `governor-text.ts`: all user-visible strings.

### process-service state machine **[R1-2, R1-3, R2-2, R2-8]**

`ProcessInfo.state` gains `"queued"`. `queued -> running -> exited|killed`; `queued -> exited` on cancel (exit code null).

`launch()` is split into `register()` (synchronous) and `spawnNow()`:

0. **Two paths, one rule set [R5-1].** A command takes the **async path** only when it needs something awaited before spawn:
   a heavy slot, or the Linux memory-limit probe. Every other command (Off, priority-only, slots on but not heavy, macOS,
   Linux without a memory limit) takes the **sync path = exactly today's code**: `await files.prepare()`, spawn, then add to
   `entries`/`foregroundEntries`; `runForeground` and `start` resolve only after spawn. No new stop window, no `register()`
   split, `list()` never sees `pid: 0`. Off always takes the sync path.
   The async path is the one described below: it registers **synchronously** (into `entries`, and `foregroundEntries` for
   foreground), takes the slot (if any), then runs `spawnNow()` as `void spawnNow().catch(fail)`. Every `await` before the
   spawn (`files.prepare()`, the probe) lives inside `spawnNow()`; **`entry.cancelled` is checked as the last synchronous
   statement before `spawn`**, after every await. If set: release the slot (if held), settle `admitted`, return; for a
   foreground call `runForeground` resolves a run whose `outcome` is `{ kind: "exited", exitCode: null, stopRequested: true }`
   (never a rejection). `stopEntry` is idempotent (`if (entry.cancelled) return`, after `await entry.writes`). The entry
   reads `queued` until spawn, even while a granted slot sits through `prepare` or the probe **[R4-8]**.
   **`fail` [R4-1, R5-2]:** a throw in `prepare`, the probe or `spawn` releases the slot, removes the entry, settles
   `admitted`, and rejects the foreground `outcome` (or `start()`), so `bash.ts` handles it in its existing `finally`. If the
   entry was already **backgrounded**, `outcome` has settled, so `fail` instead keeps the entry listed as `killed` and
   sends a `processExitNotification` carrying the error text, so the model is never left waiting for a command that never
   ran (same for the one command that fails on the probe's degraded transition). `admitted` means "spawn attempted or
   cancelled". Tests: `prepare`, probe and `spawn` throws, each on the sync path and the async path; fail-after-background.
1. *(async path)* `register()` creates the `Entry`, adds it to `entries`, adds foreground entries to `foregroundEntries`, and, when a slot is
   needed, sets state `queued` and calls `queue.acquire` — **all synchronously, before any await** (the persist `await` comes
   after), closing the register/acquire window. It then persists (`pid: 0`) and emits change. For foreground entries `persist`
   still returns early (`process-service.ts:138`); the first write happens in `background()`.
2. *(async path)* When `acquire` resolves, `spawnNow()` first checks **`entry.cancelled`**. If set it releases the slot, resolves
   `admitted` and returns without spawning. Otherwise it spawns, flips to `running`, **sets `entry.pid` and re-persists**
   (so a backgrounded entry never keeps `pid: 0`), and wires slot release to `running.exited` (also on spawn throw).
3. *(async path)* `stopEntry`: if `entry.running` is undefined, it sets `entry.cancelled = true`, calls `waiter.cancel()` (pending or
   granted), sets state `exited`, settles the foreground outcome as `{ kind: "exited", exitCode: null, stopRequested: true }`,
   resolves `admitted`, persists, emits. `stopAll`, `onConversationRemoved`, `stop(id)`, `stopResourceCommand` and the bash abort guard all go
   through `stopEntry`, so every path is covered, including a stop between grant and `spawnNow` and between `register` and
   `acquire`.
4. `ForegroundRun` gets `admitted: Promise<void>` (settles at spawn attempt or cancel; already settled on the sync path) and
   its own `outcome` promise that does not depend on `entry.running` (today `runForeground` dereferences it at
   `process-service.ts:282`). `bash.ts` starts the timeout on `run.admitted` (queue time never counts) and creates `guard`
   immediately so an abort while queued calls `run.stop()`. `context.abortSignal` is optional; without it a queued call is
   cancellable only by Stop.
5. Queued output **[R2-7]**: one line, sent **once**, counts only: `Waiting for a free slot (2 of 2 busy)...`. No other
   thread's command text ever reaches model-visible output. Detail lives in the Resources panel.
6. `background()` accepts `queued` and `running`; a queued entry stays queued, then starts and is announced on exit.
7. `hasRunning` counts `queued`. The web `runningCount` (`web/src/processes/process-state.ts`) counts `queued`.
8. `reapStaleAtStartup`: a persisted `queued` record is rewritten to `killed` with the log note "not started: tau restarted",
   no group kill (`groupIsAlive` already guards `pid <= 0`).
9. Off: sync path, `wrap = null`, no queue, no settings read, no probe, no timer. Spy tests assert **call order** (no settings
   read, `spawn` called with today's argv, entries added after spawn as today), not just absence.

**Slot lifetime [R1-7]:** released on exit, spawn failure, cancel. A command moved to the background keeps its slot until
exit. `cmd &` frees the slot at shell exit (known gap). **Eviction [R2-3]:** the Resources panel shows a live list "Heavy
commands" (running and queued: thread title, truncated command, time) from `Core.settings.resourceActivity()`, each with **Stop**, calling `Core.settings.stopResourceCommand(entryId)` which goes
through `stopEntry`. That works across threads on the node, even though foreground entries are not in the process list.
**Refresh [R3-2]:** `announce()` emits only for visible entries and foreground ones are not visible
(`process-service.ts:227-229`), and `Change{resource:"processes"}` is per conversation (`entities.ts:292`). So the protocol
gains a node-wide `Change` variant `{ resource: "resources" }` (part of the hashed surface), emitted by the core on queue,
grant, spawn, exit and cancel regardless of visibility; the web invalidates `resourceActivity` on it
(`web/src/lib/use-changed-invalidation.ts`, `queries.ts`, owned by foundation).
**Stop reason contract [R4-2]:** `stopEntry(entry, reason)` with `reason: "user" | "timeout" | "resources" | "memory"`. The
reason is stored on the entry and added to `ExitDetails` and to `ForegroundOutcome` (`stopReason?`). `bash.ts` maps it to
the tool message (`user` -> "Command aborted", `timeout` -> today's text, `resources` -> "Stopped from Resources settings",
`memory` -> "Stopped: memory limit <n> MB exceeded"); `processExitNotification` for `process_start` uses the same map. A
sampler kill sets `memory` before signalling. For a Linux scope the `systemctl show` read-back (with its 200 ms retry) is
chained **inside the `exited` promise**, before `outcome` settles, so the cause is known when the tool returns. A scope that
stays `active` because the command left a daemon in it is **not detected as a memory stop** (documented). Foundation owns the
`ForegroundOutcome`/`ForegroundRun`/`ExitDetails` types: **in Phase 1, before the parallel phase**, foundation moves them to
`processes/process-types.ts` and **re-exports them from `process-service.ts` and `running-process.ts`**, so no import
changes, and updates `bash.ts`'s import line **[R5-3]**. `stopReason` lives on `RunningProcess` too (`finish()` reads
`running.stopRequested`, `settle()` derives `killed` from it, `running-process.ts:62-72,134-136`). **Classification hook
[R5-4]:** `SpawnRequest` gets an optional async `classifyExit(exit) => Promise<StopReason | undefined>`; `done()` awaits it
before `finish()`, which is how the Linux `systemctl show` read-back lands inside `exited`. A scope OOM kill is not
tau-requested (`stopRequested` false), so `bash.ts` checks `stopReason === "memory"` **before** the exit-code branch,
independent of `stopRequested`; when two reasons race the first wins. `stopEntry`'s idempotent path
still `await entry.writes` so a second caller (`stopAll`) returns after the persist **[R4-8]**. A cancelled backgrounded
entry sends no exit notification, matching today's `!stopRequested` rule. `stopResourceCommand(entryId)` accepts only ids
currently listed by `resourceActivity`, so it never widens `processes.stop`.
**Eviction semantics [R3-7]:** `stopResourceCommand` is deliberately **not** `ownerOnly`, like `setClaudeConnectors`: any
device that can open Settings can already see and stop that node's threads. A command stopped this way returns a distinct
tool message, `Stopped from Resources settings`, instead of a generic abort. `resourceActivity` shows thread titles and
command text to every device that can open the panel, the same as what those devices already see per thread.

**Setting changes [R1-8]:** `setResources(next)` updates `resource-state` and calls `queue.setLimit(next.heavySlots)`;
`null` drains every waiter. Priority and memory apply to the next spawned command only.

### Protocol, server, web

`ProcessInfoSchema` is in `protocol/src/mvp5.ts:39-48`, `SettingsSchema` in `entities.ts` **[R1-9]**. Adding `queued`,
`resources`, and the new calls (`setResources`, `resourceSupport`, `resourceActivity`, `stopResourceCommand`) changes
`protocolSurface` (plus the `Change` variant `{ resource: "resources" }` **[R3-2]**), so the foundation agent runs `bump-protocol`. `node-rules.ts` has only link refusals; node settings are
proxied per node by `NodeProvider`/`NodeSectionGuard`; the Resources rows live inside the existing **Agent** section (`NODE_SECTIONS` is unchanged). A new web against an
older node gets `settings.resources === undefined` and a 404 on the new calls: the web treats that as "not supported on this
node" (rows disabled, "This node needs an update"). Foundation updates `process-state.ts` (`stateLabel` queued -> "Queued",
`runningCount`) and `ProcessRow.tsx` (Stop for `queued` and `running`).

`createSettingsApi` gets an `onResourcesChanged` dependency, like `onClaudeConnectorsChanged` (`settings-api.ts:25`)
**[R2-9]**: foundation adds the hook and a stub, the core agent wires it in `create-core.ts` to `resource-state` and the queue.

### Web

A **Resources** group inside the existing Agent section (`web/src/settings/agent/AgentSection.tsx`, after the workspace row; no new section, no `sections.ts` or `section-bodies.tsx` change; user decision). The group is a `ResourcesGroup` component from `web/src/settings/resources/` and holds: SegmentedControl for priority (Off, Balanced "Lower priority",
Background "Lowest priority, for unattended runs"), number field plus switch for heavy slots, number field plus switch for the
memory limit, an **Apply to** group of three checkboxes (Main checkout threads, Worktree threads, Subagents; disabled while all three controls are off), a read-only support line from `resourceSupport()` (`Kernel memory limits`, `Best effort (polled)`, `Basic`, plus
the cgroup limitation note on Linux), and the live "Heavy commands" list with Stop. Each row is a `SettingRow` with a
`settings-index.ts` entry.

## Ownership

- **Foundation agent** (owns everything shared): `protocol/**`, `testkit/**` (incl. `fake-processes.ts`, contract), `server/src/rest/**`,
  `core/src/settings-api.ts` (with the `onResourcesChanged` hook and stubs), `core/src/home/settings-store.ts`,
  `web/src/lib/api.ts`, `web/src/lib/transport/fake.ts`, `web/src/settings/{settings-index.ts (entries use section `agent`),use-setting-entries.ts}`, `web/src/settings/agent/AgentSection.tsx` (mounts an empty placeholder `ResourcesGroup`),
  `web/src/processes/{process-state.ts,ProcessRow.tsx}`, `web/src/lib/{use-changed-invalidation.ts,queries.ts}`, `processes/process-types.ts`, and the `ProcessDeps` shape (a second **optional** dep `emitResourcesChange?: () => void` next to `emitChange`, so the five existing `createProcessService` callers keep compiling; the core agent wires it in `create-core.ts`) **[R5-3]**. The two test-support files, `harness/subagent-test-support.ts` and `test-support/process-tool-services.ts`, belong to the core agent **[R4-7]**. `use-changed-invalidation.ts` gets an **explicit branch** for `{resource:"resources"}` (its final `if (change.resource !== "conversations") return` swallows new variants silently), with a test; the query key for `resourceActivity` is fixed by foundation. Done when `check`, `test`, `build` pass; contract frozen.
- **Core agent:** `core/src/processes/**` (incl. `governor/`, injectable `spawn` in `spawnRunning`), `harness/tools/{bash.ts,process-start.ts,monitor.ts}` (they resolve `governed` and pass it to the service),
  `create-core.ts`.
- **Web agent:** `web/src/settings/resources/**` only.
- **Integrator:** merges each branch, `check` and `test` after each. Notes for other owners go in `NOTES-<agent>.md`.

## Phases

- **Phase 0 spikes (recorded here):** (1) Linux `systemd-run --scope --unit -- nice … <shell> -c` pid/exec/signals, and
  `Result` read-back + `reset-failed` flow. (2) macOS memory metric, per-sweep cost, and whether `bun:ffi` + `proc_pid_rusage`
  works in the compiled CLI (BUN-BINARY.md). (3) A second Linux environment (container/WSL without user systemd): probe reports
  it and falls back. (4) User feel under `utility` and `-b` with a 12-process load (a note, no UI claim). (5) Detecting
  "tau is in a session scope vs a service" from `/proc/self/cgroup`.
- **Phase 1** foundation. **Phase 2** core + web in parallel. **Phase 3** integration, then real verification: built CLI,
  browser, Balanced + 2 slots, 4 threads each running a heavy command: confirm queue message, ordering, Stop on queued and on a
  holder from the panel, setting change draining, memory kill message.

## Tests

- Pure: `heavy-command` table (heavy, light, watch variants incl. `tsc -w`, `jest --watchAll`, `pnpm --filter x test:watch`,
  `pnpm -r test`, `pnpm -w test` known fail-open, chained, wrapped); `wrap-command` argv per platform and mode, Off = null;
  `slot-queue` (FIFO, cancel pending, cancel granted-unconsumed, idempotent release, live limit up/down, `null` drains);
  sampler parsers; tree builder with `setsid` escapee and double-fork fixtures; start-time guard against pid reuse.
- `spawnRunning` takes an injectable `spawn` so tests assert argv and simulate failures.
- Core integration (real `sh`): stop between grant and `spawnNow`; queued-then-stopped;
  queued-then-conversation-removed; queued-then-`stopAll`; restart with a persisted `queued` record (note written); setting
  change with waiters; abort while queued through `bash.ts`; timeout not counting queue time; `background()` of a queued call
  and pid persisted after spawn; `hasRunning` with only a queued entry; slot release on exit/stop/timeout/spawn error; probe
  failure fails that one command with the explicit message and the next uses the basic wrapper; user command exiting 1 is not
  misread; `stopResourceCommand` on a holder from another thread.
- Off path: spies on settings reads and `spawn` argv with call-order assertions; `admitted` settled (the run is returned after spawn); no probe, no
  `reset-failed`, no `ps` timer.
- **[R3-1, R3-3, R3-4]** Stop during `files.prepare()` and during the probe (injected slow ones): no spawn, slot released, K never
  exceeded; double `stopEntry` re-persists and re-emits nothing; two concurrent spawns share one probe; probe timeout; one failed
  command on the degraded transition then the basic wrapper; slots-only settings never probe; `show` retry when `ActiveState` is
  not settled; two node ids never clear each other's units; absolute binary paths under `PATH=/usr/bin:/bin`; `lstart` parsing
  under `LC_ALL=C`; sticky-set survives root exit up to 30 s; `Change{resources}` emitted on queue/grant/spawn/exit/cancel for a
  foreground entry; evicted command shows the distinct message.
- **[R5, R6]** Apply to: each class (main, worktree, subagent incl. `task` child without `agentType`, subagent of a worktree
  thread) is governed exactly when its box is ticked; user forks (`parentId` null) classify by workspace; unknown id is
  ungoverned; with every control Off or no box ticked the conversation lookup is never called (spy); governed commands pass
  `governed` into the service and ungoverned ones take the sync path with `wrap = null`; settings-store validates `appliesTo`
  per field with default `{ main:false, worktrees:false, subagents:true }`, and contract tests cover partial and missing
  `appliesTo`; Linux `background` wrapper fallback branch; sync PATH scan with a short PATH; fail-after-background sends an exit
    notification; `stopReason: "memory"` wins over the exit-code branch with `stopRequested` false; classification awaited before
  `outcome` settles; `emitResourcesChange` optional (existing constructors compile); one fresh sweep before
  each kill batch.
- Platform-gated real tests: Linux scope memory kill reports `Result=oom-kill`, unit cleaned by `reset-failed`; macOS polled kill
  takes down a `setsid` child; skipped when unsupported.
- Contract: round trip, validation (1..64, >= 64), default Off, missing field tolerated, partial settings.
- Web: section renders, saves, search finds each row, support line per platform, unsupported-node state, holders list Stop.
- E2E: setting persists across reload.

## Risks

| Risk | Mitigation |
|---|---|
| Heavy detection misses wrappers | Fails open; list is one tested file; priority and memory apply to every governed command |
| Slot starvation | Only foreground bash; watch never heavy; panel shows holders with Stop; K=null drains |
| macOS memory poll false kill or miss | Tree plus sticky set, start-time guard, two-sweep rule, Phase 0 metric; UI says best effort |
| Linux priority does not yield across cgroups | Stated in UI; nice/chrt measured to work in the same cgroup; Balanced ~25% share, labelled "lower priority" |
| Wrapper unavailable at runtime | Lazy probe with TTL and real env; explicit one-command failure; basic wrapper afterwards |
| Mid-run kill confuses the agent | Message from detected cause (`Result=oom-kill` or sampler), never a bare exit code |
| Failed scope units pile up | No `--collect`; `reset-failed` per unit (errors ignored: a not-loaded unit exits 1) and once per tau start; node id sanitized to `[a-z0-9]` plus a fixed-length hash so `tau-<id>-*` can never match another id **[R4-6]** |
| Settings apply to new commands only | In the setting's description |

## Notes from round 7 (approved) [R7-2, R7-4, R7-5]

- `launch()` no longer reads `resource-state` as a gate: the tool-level `governed` flag is the only gate; the service reads only the values (wrap, slots, limit). A setting change between the two reads is benign.
- The default `appliesTo { main:false, worktrees:false, subagents:true }` leaves a main thread working in its own worktree ungoverned. This is a deliberate user decision, stated in the UI hint. With any control on and all three boxes unticked, the panel shows a one-line "Nothing is governed" hint.
- Ownership exception: Phase 1 foundation edits `process-service.ts`, `running-process.ts` and `bash.ts`'s import line (core agent's files); this is safe because Phase 1 finishes before Phase 2. The core agent adds `governed?: boolean` to `StartProcessRequest` and `ForegroundRequest` itself.
