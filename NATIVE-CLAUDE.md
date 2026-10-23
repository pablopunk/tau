# Native Claude Code threads (experimental)

Status: **always on when Claude Code is installed.** Existing threads, the Pi runtime and the legacy `claude-cli` provider are unchanged. Nothing migrates automatically.

## What it is

A thread owns exactly one executor. A native thread runs the real Claude Agent SDK, which owns its tool loop, tools, skills, rules, hooks and compaction. Tau keeps the thread in its normal sidebar/mobile/node model. State (admission, queue, lifecycle, events) lives in a passive Pi conversation that never receives a model call.

## Availability

There is no switch. At startup the node runs `claude --version` (`TAU_CLAUDE_PATH`, else `claude` on the `PATH`; the SDK's bundled binary does not count). If that works, native threads can be created and run, and the new-thread screen offers the engine toggle with Claude Code preselected (the last engine you pick is remembered per node). If not, the toggle is absent. Install Claude Code, then restart the node.

Runs use the Agent SDK's own pinned Claude Code build, not the binary on your `PATH`. The local install decides availability and holds your `~/.claude` settings, which native threads read.

| Env var (read at core startup) | Effect |
|---|---|
| `TAU_EXPERIMENTAL_NATIVE_DELEGATION=1` | A Pi parent may run an awaited native child via the `agent` tool. Off: the tool is byte-identical to before. |

Check a node with `GET /api/runtimes` (per-node executors and capabilities).

## When Claude Code goes missing

If Claude Code is no longer installed but native state exists, the node starts in **retained mode**: existing native threads stay readable and cancellable, startup reconcile still runs (never relaunches), and any new run or new native thread is refused. Installing it again and restarting resumes. Never route a native thread into Pi.

A runtime-format file (`<tauHome>/runtime-format.json`) is written before the first native record. A build that does not support its format refuses to start before opening the store. Pre-refactor binaries do not check it: do not run an old binary against a home that has native threads. Restoring one needs a backup taken before the first native thread.

## Safety rules this build keeps

- Every run takes a checkpoint first. A failed checkpoint blocks the run and keeps your input.
- Sandbox: the node's per-scope sandbox setting applies. Sandbox on with no enforcement path refuses to launch (fail closed). Only `~/.claude`, `~/.claude.json` and temp are writable extras.
- Permissions: read-only tools inside the workspace are allowed; everything else asks through the existing approvals UI. Deny, timeout, cancel and thread removal all deny. Native approvals never persist "always allow". `bypassPermissions` is rejected.
- Processes: each child has a verified identity (pid plus start time). Stop counts only after death is verified. A crash never replays a run: it becomes an explicit **outcome unknown** that must be acknowledged before the next run. Unknown is never reported as success (`tau wait` exits non-zero).
- A cancel acknowledged to you can never be followed by a launch (durable atomic marker).
- Merge/remove/discard fence sibling writers using real native writer state; unknown denies, even with `--force`.

## Handoff

"Continue in Claude Code…" (or `tau threads handoff <id>`, dry-run by default) creates a **new** native thread from a Pi thread. The export is deterministic text; images, thinking, long tool output and old turns beyond the budget are dropped and listed in a preview. The source thread is untouched.

## Not supported yet

Attachments, steering a running native thread, rewind/fork/compact on native threads, goals/timers, background native children, replay-safe re-attach of a delegated child after a Tau crash, in-place switching of a thread's executor.

## Verify on a host

```sh
mise exec -- pnpm exec tsx scripts/verify-runtime-boundary.ts --platform current --require-supported --output test-artifacts/runtime-boundary.json
mise exec -- pnpm exec tsx scripts/benchmark-runtime.ts --offline --config e2e/runtime-benchmark.config.json --output test-artifacts/runtime-benchmark.json
```

The verifier exits 0 (all supported checks passed), 2 (a required capability is unsupported on this host) or 1 (failed assertion). It has been run on macOS only. The benchmark measures deterministic overhead, not provider latency: offline, native is slower per run than Pi (about 1.2 s vs 0.3 s p50 on the author's machine). There is no speed claim.

## Not yet verified

Still **not done** (it ships on regardless, so treat these as known risks): a run against a sanitized real company configuration (native tool hooks, delegation gates, rules/skills/plugins, denied actions, headless permissions); the verifier on Linux; real-auth session behavior including whether the CLI's atomic `~/.claude.json.tmp.*` writes survive the sandbox; a real-provider comparison; an explicit decision on cross-runtime delegation policy coverage. All linked nodes must run a build with the same protocol hash.
