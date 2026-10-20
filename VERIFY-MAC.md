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
