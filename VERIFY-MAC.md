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
