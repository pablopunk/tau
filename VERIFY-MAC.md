# Mac verification of resource control (Darwin, Apple silicon 8P+4E, 12 cpus)

Machine was not idle (browser, Slack, other agents): numbers are indicative, ratios matter.

## 1. Priority really applied — PROVEN

`e2e/tests/resources-priority.spec.ts` (built CLI, faux server, scripted bash thread per mode, PUT /api/settings/resources).
Each command prints `ps -o pid,pri,nice,state,flags -p $$`, its QoS CPU-time bands (`e2e/fixtures/rusage.py`,
`proc_pid_rusage(RUSAGE_INFO_V4).ri_cpu_time_qos_*`, via ctypes) and the wall time of a fixed job (12 python procs, 4M loop iterations each).

| mode | `ps` PRI | QoS band | job time |
|---|---|---|---|
| off | 20 | utility 100% (inherited from the parent) | 0.46 s |
| balanced (`taskpolicy -c utility`) | 20 | utility 100% | 1.01 s (2.2x) |
| background (`taskpolicy -b`) | 4 | background 100% | 7.83 s (17x) |

Findings:
- `ps` and `taskpolicy` show nothing for Balanced (no `taskpolicy -g` exists; `launchctl procinfo` needs root). Only Background is
  observable (PRI 4, background QoS band); Balanced is observable only by timing under contention. Because the band reads
  "utility" for Off as well here (inherited from the shell that started tau), an Off thread is not distinguishable from Balanced by band when tau itself runs at utility.
- Manual idle-machine runs, 12 procs x 20M iterations: normal 4.6-4.7 s, `-c utility` 4.8-5.0 s (1.05x), `-b` ~20x. So the
  plan's "utility = 2.7x" does not reproduce on an idle machine here; Balanced only costs time when something else competes.

## 2. Memory limit kill (memoryLimitMb=200) — PROVEN, one bug FAILED-FIXED

`e2e/tests/resources-memory.spec.ts` + `e2e/fixtures/hog.py` (macOS has no `setsid` binary: the escapee calls `os.setsid()`).
Tool output is read over the live WebSocket (`toolOutputs()` in `e2e/resources-support.ts`; `tau threads read` omits tool results).

| case | result |
|---|---|
| python holds 600 MB | tool output `Stopped: memory limit 200 MB exceeded`, command ended 2.9-3.1 s after thread start (first sweep at 2 s, over 1.5x so no second sweep; the "≥ 4 s" only applies to 1.0-1.5x overruns) |
| `setsid` child holds 300 MB, parent sleeps | same message at 3.0 s, escapee pid dead (kill -0 fails) |
| daemon: child 100 MB, parent exits at 3 s, child grows to 400 MB at 4 s | the post-exit watch (sticky set) killed it: dead 1.0 s after the command ended |
| 60 MB under the limit | no kill |
| 120 MB MAP_SHARED + 3 readers (ps RSS sums to ~490 MB) | **FALSE KILL before the fix**, no kill after |

### Bug: RSS false kill (fixed, see section 6)
The sampler summed `ps rss`, which counts shared pages once per process. Fixed by confirming with macOS `footprint` before any signal
(`governor/footprint.ts`, `memory-watch.ts`; unit tests in `memory-watch.test.ts`).

## 3. Subagent classification and other tools — PROVEN

`e2e/tests/resources-classify.spec.ts` (real `agent` tool in a scripted parent, `heavySlots: 1`, activity polled every 150 ms):
- Only Subagents ticked: parent runs `cargo test --parent-marker …; sleep 9` and starts two subagents running heavy commands. Activity only ever lists the two
  children (peak 1 holder + 1 waiting); the parent command never appears and its tool output has no "Waiting for a free slot".
- Only Main ticked (thread started in `checkout`): the parent's command is the holder; subagent commands never appear.
- Only Worktrees ticked: a `checkout` thread is never listed; a `worktree` thread is the holder.
- `process_start` + `monitor` with priority background, 1 slot, memory 200 MB, all boxes ticked, next to a bash holder: both `ps -o pri` print `4`
  (background band), both are killed by the 600 MB hog (state `killed`), none is ever queued or listed in activity although the process_start command matches the heavy matcher.

(Extra data point for 1: 12 procs x 20M iterations on a loaded machine: normal 4.89 s, `-c utility` 5.94 s, `-b` 27.4 s = 5.6x.
The background factor depends strongly on load: 17-22x for the 4M-iteration job, 5.6x here.)

## 4. Settings change live, Stop, restart — PROVEN

`e2e/tests/resources-live.spec.ts` (4 scripted heavy threads, polled `GET /api/settings/resources/activity`):
- slots 1 -> 4 threads: 1 holder + 3 waiting. Raise to 3: 3 holders + 1 waiting within 5 s. Lower to 1 then 2: nothing killed, still 3 holders + 1 waiting
  until they finish (lowering never kills, as designed); all four end with their output.
- everything Off with 3 waiting: waiters drained 2-4 ms later (they become holders and run together).
- Stop on a queued entry (`DELETE /api/settings/resources/activity/:id`): the thread's tool output is `Waiting for a free slot (1 of 1 busy)...` then `Stopped from Resources settings`; the holder keeps going.
- timeout 5 s on a command queued ~10 s: ran and finished (`tmo-done`), queue time not counted.
- a queued call moved to the background (`POST .../tool-calls/:callId/background`) is persisted `queued`; after `kill -9` of the server and a start,
  the record is `killed` and its log is `not started: tau restarted`. After a graceful stop/start the record is `exited` (stopAll cancelled it first), never `queued`.

New core tests (vitest): `processes/governor/governed.test.ts` (Apply-to classification table, forks, subagent of a worktree thread, unknown/deleted/throwing lookup,
lookup never called while Off or no box ticked), `harness/tools/bash-resources.test.ts` (abort while queued never spawns; timeout starts at spawn;
real macOS memory kill of a command plus its `setsid` escapee, platform-gated).

## 5. Compiled binary — PROVEN

`pnpm build:binary --out /tmp/taubin/tau-9.9.9 --version 9.9.9` (3.4 s), then the same specs with `TAU_E2E_BINARY=/tmp/taubin/tau-9.9.9/tau`
(`resources-support.ts` starts it through `tau start --faux` with stubbed `launchctl`/`systemctl`; `ps` during the run showed
`/private/tmp/taubin/tau-9.9.9/tau serve --service --no-open --home …`). All pass against the compiled CLI:
priority (4 tests: background PRI 4 / band background, 6.67 s vs 0.37 s), memory (5 tests: 2.7 s kill, setsid escapee dead, daemon tail kill, no false kill incl. the shared-memory case, so `footprint` works from the compiled binary),
Apply-to classification + process_start/monitor (4), live settings/Stop/timeout/crash-restart (6). 19/19.
`ps`, `taskpolicy` and `footprint` are spawned by absolute path (`/usr/sbin/taskpolicy`, `/bin/ps`-via-PATH, `/usr/bin/footprint`), which Bun's `child_process` handles like Node.

## 6. Memory metric spike — PROVEN (false kill found and fixed); compressed memory NOT-PROVABLE here

`python3 -I e2e/fixtures/metric-spike.py` (whole process tree, MB; `top -l 2 -pid … -stats pid,mem`, `footprint` Summary line, and the sum of
`proc_pid_rusage(...).ri_phys_footprint` per pid via ctypes, which is what a `bun:ffi` read would give):

| case | procs | ps rss | top mem | `footprint` summary | sum of rusage phys_footprint |
|---|---|---|---|---|---|
| private 300 MB touched | 1 | 317 | 310 | 310 | 310 |
| 300 MB written with zeros | 1 | 317 | 310 | 310 | 310 |
| MAP_SHARED 100 MB, 4 processes | 4 | **431** | **418** | **119** | **419** |
| COW fork of 100 MB, 4 processes | 4 | 130 | 119 | 118 | 119 |
| ten idle `node` processes | 10 | **381** | 110 | 112 | 112 |

Findings:
- ps RSS over-counts memory shared between processes and the dyld shared cache: ~26 MB per idle node process (37 MB RSS vs 11 MB footprint). 4 processes sharing 100 MB read 431 MB.
- Summing per-pid `proc_pid_rusage` does NOT fix that for shared mappings (419 MB); only the `footprint` summary de-duplicates (119 MB). So an ffi
  `proc_pid_rusage` read is not worth adding: nothing beats `footprint`.
- `footprint` costs 126 ms for 30 pids in one call, 48 ms for one pid (vs ps sweep 30-50 ms).
- Real false kill reproduced (section 2): 120 MB shared with 3 readers under a 200 MB limit was killed on RSS (4 x 122 MB > 1.5 x limit) at the first sweep.
  Fix: RSS stays the cheap trigger; before any signal the whole tree's footprint is read with ONE `footprint -p … -p …` call and the kill is skipped when it is within the limit
  (`overSweeps` resets). If footprint cannot be read the decision falls back to RSS. The same spec now passes (also from the compiled binary). Recommended metric: RSS to trigger, `footprint` summary to confirm.
- Not provable here: compressed memory. The machine has 48 GB with 78% free and the compressor never engages, so a "compressed pages leave RSS" miss could not be forced.
  By Apple's definition `phys_footprint` includes compressed pages, so the confirm step is right; the trigger (RSS) could miss a tree whose pages were compressed under real pressure. Left as is.

## 7. Older node compatibility — PROVEN (with a caveat on which message shows)

`e2e/tests/resources-old-node.spec.ts`: a real installed older release (`~/.local/share/tau/versions/0.5.3/tau`, `tau --version` = 0.5.3, no resource control) is
started on its own home, linked to the current build with `tau connect --node`, and the web's Settings → Agent → "Old node" tab is opened.
Result: the link works but the node's status is `update-required` (the protocol surface changed, so the hash gate flags it), and the tab shows
`Old node needs a tau update before its settings can load. Its settings will load once it's back online.` with no Resources controls and no page error.
The Resources-specific "This node needs an update" (online node, `settings.resources === undefined`) is unreachable with real releases because the
protocol hash gate stops them first; it stays covered by `ResourcesGroup.test.tsx:150`. The spec accepts either text.

## 8. Real-world comparison — PROVEN (numbers), with a finding about Balanced

`e2e/tests/resources-compare.spec.ts` (opt in: `TAU_E2E_COMPARE=1 TAU_COMPARE_REPO=<copy of this repo with node_modules>`; the copy was `cp -cR` of this worktree).
Four scripted threads (checkout mode, all three Apply-to boxes ticked) each run `mise exec -- pnpm --filter @tau/core test` (1240 tests; alone on this machine: 127 s wall, 187 CPU-s).
Every 2 s: `ps` count of processes whose command line contains the copy's path ("test processes"), `vitest.mjs run` count ("suites"), 1-min load average.
CPU = `times` of each command's shell (children included). "Lone job" = a single-process fixed CPU job (6M iterations, 0.35 s idle) started from outside tau at normal priority every 0.5 s while the agents run, a proxy for UI responsiveness.
The Mac was not otherwise idle (browser, Slack, MDM agent, WindowServer ~ 1-3 cores), so load numbers include that baseline of roughly 8-17.

| mode | wall | suites at once (peak) | test procs (peak) | load1m peak / mean | total CPU | lone job median / p95 / max | suites that failed tests |
|---|---|---|---|---|---|---|---|
| Off | 243 s | 4 | 52 | 90.4 / 57.7 | 871 s | 0.54 / **10.3** / **15.7** s | 3 of 4 (1 test each, timing under load) |
| slots 2 | 465 s | 2 | 26 | 81.4 / 51.5 | 1001 s | 0.80 / 7.7 / 11.7 s | 0 of 4 |
| Balanced + slots 2 | 527 s | 2 | 26 | 77.0 / 48.8 | 1051 s | 0.82 / 8.1 / 9.1 s | 2 of 4 (1 test each) |
| Background + slots 2 | 1124 s | 2 | 27 | 46.3 / 27.3 | 1739 s | **0.35 / 0.44 / 1.3 s** (idle 0.35-0.45) | 4 of 4 (13, 13, 3, 7 tests: timeouts) |

Per-suite run time once admitted: Off 238 s (all four together), slots 2 261 s / 200 s, Balanced 260 s / 264 s, Background 580 s / 539 s; queued suites waited ~260 s (slots 2, Balanced) and ~581 s (Background).

Findings:
- Concurrency works as designed: peak test processes 52 -> 26, never more than 2 suites. But with this suite (which does not scale to 12 cores: 3.6 cores average with 4 suites) queueing 2 of 4 costs ~2x wall (243 -> 465 s) and does not remove the stutter: the lone job is still 20-30x slower at p95 with 26 processes.
- **Balanced is not a UI-smoothness tool on macOS**: it behaves like slots-only (p95 8.1 s vs 7.7 s; section 1 shows utility ≈ normal when nothing else competes). Its label "lower priority" is accurate, but expect little.
- **Background is the only mode that keeps the machine usable**: the lone job stays at idle speed (p95 0.44 s) and load halves. Cost: 4.6x the wall time, 2x CPU seconds (cores/E-core cache), and timing-sensitive tests fail (3-13 per suite timed out). Good for unattended runs only, as the UI says.
- Off is itself flaky under 4 parallel suites (3 suites with a failing test); gating to 2 removed that.

## Final status

`pnpm check`: 0 errors (24 pre-existing warnings). `pnpm build`: ok. Tests: protocol 87, testkit 223, server 367 (one run showed 5 flaky failures while the machine was saturated; green on rerun), core 1240 (+3 skipped), web 736, cli 303.
Bug found and fixed: macOS memory sampler false-killed trees whose RSS double-counts shared pages (fixed with a `footprint` confirm, commit "core: confirm macOS memory kills with footprint").
Not provable here: memory compressed under real pressure (48 GB, never engaged). Left as findings: Balanced has little effect on macOS; Background is the effective mode.
No change was needed in `governor/wrap-command.ts` or `resource-support.ts` (no NOTES-mac.md).
