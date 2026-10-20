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
