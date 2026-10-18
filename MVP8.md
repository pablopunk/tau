# MVP8 plan: effort, monitors and timers

Status: APPROVED v6 (v3 approved; `/goal` added by user request, goal review rounds 1–2 applied). Builds on [MVP6.md](MVP6.md) (subagents, notifications), MVP5 (background processes) and [MVP7.md](MVP7.md) (CLI command table).

## Goal

> The agent works like a Claude Code lead: it gives each subagent a model **and an effort**, it watches commands and processes without polling, and it comes back later on its own (wake-ups, repeats, `/loop`).

## Scope

In:
1. **Thinking level per subagent**: `agent({ thinking })`, agent-type frontmatter, and the UI.
2. **Monitor**: a background command whose stdout lines wake the agent.
3. **Exit notifications**: `process_start` processes tell the agent when they exit by themselves.
4. **Timers**: one-shot wake-ups and fixed-interval repeats, durable across restarts. No cron expressions.
5. **`/loop`**: a core call, used by the web and the CLI.
6. **UI**: notification rows, a timers chip in the thread header, a clock badge on the avatar.
7. **`/goal`** (user request): a completion condition; the agent keeps working until a judge model says it is met, like Claude Code's `/goal` (https://code.claude.com/docs/en/goal.md).

Out: cron expressions, push to the phone, workflows, timers that start new threads, a global timers page.

## Shared: the notification submitter

- MVP6's `harness/subagent-notification.ts` becomes a general `NotificationSubmitter` (Foundation): `notify(conversationId, { kind, data, text, requestId })` submits one input with `whenBusy: "followUp"` and a custom `app.*` entry. Pi Durable deduplicates by `requestId` (README:117-122), so a repeated call is a no-op.
- The process service and the timer scheduler get the submitter injected. Subagent reports use it too. Nothing else builds these inputs.
- Kinds: `app.subagent_notification` (exists), `app.monitor_event`, `app.process_exit`, `app.timer_fired`, `app.notice` (rare one-line events: a timer expired, a monitor stopped because tau restarted, a monitor stopped for noise). `app.goal_verdict` (MVP8 §7).

## 1. Thinking level per subagent

- `agent` gets `thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"`. The default is the parent's current level. The level is clamped with `clampThinkingLevel` from `pi-ai/models` (as `conversations-api.ts:82` does) against the child's model.
- `ChildSpec` (`subagent-runtime.ts:33`) gets `thinkingLevel`. The child gets it through `createConversation`'s agent, as forks already do (`conversation-fork.ts:100-101`).
- Order: the tool argument, then the agent-type frontmatter `thinking:` (alias `effort:`), then the parent's level.
- The tool description and the subagents prompt say: use the effort the user asked for in this conversation ("Sonnet with low effort"); otherwise inherit.
- `list_agents` shows each child's level. `ConversationSummary.agentThinking: ThinkingLevel | null`. The agent card and the child page header show "model · level".

## 2. Monitor

```ts
monitor({ command: string, description: string, timeout_ms?: number /* default 300000; 0 = until stopped */ })
  → "Monitor <id> started. Each stdout line arrives as a notification. Stop it with process_stop."
```

- Runs through the process service with `ProcessInfo.kind: "monitor"`. It uses the same cwd, process group, log file and `process_stop` as other processes.
- The process service gets `onLine(stream, line)`, with a splitter per stream that holds a partial line. Only **stdout** lines are events, as in Claude Code; stderr goes to the log only.
- Batching: lines within 1 s are one notification, with at most 20 lines; more lines in that second are counted (`dropped`).
- Noise guard: more than 30 notifications in a minute stops the monitor with an `app.notice` "stopped: too noisy; filter with grep --line-buffered".
- The tool description teaches: filter with `grep --line-buffered`, match failure lines too, and do not poll.
- End: on exit or timeout, a last `app.monitor_event` with `ended: { exitCode } | "timeout"`.
- tau restart: processes do not survive it. `reapStaleAtStartup` reads the persisted `kind`; for each monitor it sends one `app.notice` "monitor stopped: tau restarted". Other reaped processes send nothing.

## 3. Exit notifications

- `process_start` gets `notify_on_exit?: boolean`, default `true`.
- The process service's `onExit` gets `(info, { exitCode, stopRequested, logTail })`. A natural exit sends `app.process_exit` with the exit code and the last 20 log lines. A stop through `process_stop` or the UI Stop button (both set `stopRequested`) sends nothing. Reaping at startup sends nothing.

## 4. Timers

```ts
schedule_wakeup({ delay_seconds: number /* 60..86400 */, prompt: string, reason: string })
  → "Wake-up <id> at 14:32 (in 10 min)."
schedule_repeat({ every: string /* "5m", "2h", "1d"; minimum 1m */, prompt: string })
  → "Repeat <id> every 5 min, next at 14:37, expires in 7 days."
timers_list()            → this thread's timers: id, kind, schedule, next run, prompt, times fired, source (agent or /loop).
timer_delete({ id })
```

- **No durable timer primitive exists** in Pi Durable 1.3.0 (README and `.d.ts` files: no sleep, alarm or wake API). So timers are durable data plus an in-memory scheduler.
- **Storage**: a separate doc family `app.project-timers`, one doc per project (schema `version: 1`), so timer writes never touch the conversation index. Each record: `id`, `conversationId`, `kind`, `fireAt` or `every`, `prompt`, `reason`, `source`, `createdAt`, `expiresAt`, `nextAt`, `firedCount`, `lastFireRequestId`. The scheduler lists project ids from `ProjectsDoc`, then reads one timers doc per project. The tools write in their own `api.commit`.
- **Scheduler** (`core/src/timers/`): an injected clock (`now`, `setTimer`). It runs a 30 s tick plus one timeout for the earliest `nextAt` (capped at 30 s). The tick fixes the late wake-up after a laptop sleeps, and the Node 2^31 ms limit does not apply.
- **Fire** (the public `Conversation.submit` runs its own commit, so a submit and a counter update cannot share one commit):
  1. In a commit, read the timer again. Skip it when the timer, or its thread, is deleted or archived.
  2. In the same commit, coalesce. When `tx.submissionByRequest(lastFireRequestId)` is still queued, there is at most one pending fire per timer, so only move `nextAt` forward.
  3. Submit `app.timer_fired` through the `NotificationSubmitter` with `requestId: timer:<id>:<firedCount>`.
  4. In a second commit, set `lastFireRequestId`, increment `firedCount`, and set the next `nextAt` (or remove a one-shot).
  A crash between 3 and 4 submits again with the same requestId after the restart. That is a no-op, and then the counter moves.
  When the thread is deleted between 1 and 3, `submit` throws; the scheduler catches it and removes the timer.
  `app.timer_fired` has content, so it is a real input that queues (status `queued` until placed), not a display-only write.
- **Missed while tau was down**: each timer fires at most once at startup, then keeps its schedule.
- **Limits**: 20 timers per thread, and repeats expire after 7 days with an `app.notice`. Coalescing keeps at most one fire waiting per timer. There is no daily cap: the user chose the interval, and the chip shows how often the timer has fired.
- **Lifecycle**: archiving or deleting a thread deletes its timers. The tools are parent-only (subagents do not get them). Shutdown: `scheduler.close()` clears the timers and waits for an in-flight fire, before `harness.close()`.

## 5. `/loop`

- `Core.timers.loop(conversationId, { every?: string, prompt: string })`, REST `POST /conversations/:id/loop`, CLI `tau timers loop <id> [--every 5m] "<prompt>"`. The web `/loop` slash handler calls it. No model reads a slash.
- With `every`: core creates a `schedule_repeat` timer (`source: "loop"`) and submits the prompt now (`whenBusy: "followUp"`, `requestId: loop:<timerId>:0`, so a crash cannot run the first prompt twice).
- Without `every` (dynamic): core submits the prompt with a fixed instruction: "At the end of each turn, call `schedule_wakeup` with the delay that fits (at least 5 min unless the user asked for less), or stop by not calling it." A model that does not call it ends the loop; the chip then shows no timer, which is the visible sign that the loop ended.
- `/loop stop` → `Core.timers.stopLoop(conversationId)` deletes the `source: "loop"` timers.

## 7. `/goal`

Same behavior as Claude Code's `/goal`, which is "a wrapper around a session-scoped prompt-based Stop hook". One goal per thread.

- **Commands**:
  - `/goal <condition>` (at most 4,000 characters) sets the goal and starts a turn now with the condition as the directive. A new goal replaces the active one.
  - `/goal` with no argument shows the status: the condition, the time elapsed, the turns evaluated, the tokens spent and the last judge reason.
  - `/goal clear` clears it. `stop`, `off`, `reset`, `none` and `cancel` do the same. Deleting or archiving the thread also clears it.
- **Core**: `Core.goals.set(conversationId, condition)`, `get(conversationId)` and `clear(conversationId)`, with REST routes and the CLI `tau goal set|show|clear <thread>`. The web slash handler calls these; no model reads the slash. Subagents cannot set goals.
- **Storage**: the thread's goal is a record in a durable doc `app.goal`, one per thread. `ConversationSummary.goal` changes go out through `changes.emit`, as other summary fields do. The record holds id, condition, state (`active`, `paused`, `achieved`, `failed` or `cleared`), startedAt, turnsEvaluated, tokens at the start, the last verdict and its reason, idle turns, check-ins, retries. It survives a restart and `/compact`, which is better than Claude Code, where a resume resets the counters.
- **Run end signal**: `StatusTracker.onRunEnded` (`status/status-tracker.ts:24,108`) gets an outcome: `{ conversationId, outcome: "ok" | "error" | "aborted", runStartEntryId }`. The outcome comes from the last assistant message's `stopReason`; a user Stop is `aborted`. The judge runs outside the tracker's serial queue, so a slow judge never delays status flushes.
- **The judge**, after each run of the thread ends:
  1. **Skip** when no goal is active, when the outcome is `aborted` (the goal is paused), or when `hasLiveWork(conversationId)` is true (Foundation: any running subagent child or process of the thread). When that work ends, its notification starts a run, and that run end triggers the judge again.
  2. Set `judging: { runStartEntryId }` in the goal record. **Ask** the fast model (Settings → Models fast model, else the thread's model, as `titles/title-service.ts:36-60` does). Send the condition and the transcript as text (`viewToText`), with a budget of 60,000 characters: the condition in full, then the newest part of the transcript. The answer is structured: `{ verdict: "not_met" | "met" | "impossible", reason }`. The judge only reads the transcript; it runs no commands and reads no files. The judge prompt says so, and it tells the judge to need evidence in the transcript (for example, test output) before `met`.
  The answer is parsed as JSON. A malformed answer gets one retry, then the goal pauses.
  3. **Stale verdict check**: before acting, read the thread again. Drop the verdict (and clear `judging`) when a newer run started, the thread is busy, or the goal changed or was cleared. The user's own message always wins.
  4. **not_met**: submit a continuation input with `requestId: goal:<goalId>:<turnsEvaluated>` and entry `app.goal_verdict`. The text is "Goal not met yet: <reason>. Keep working toward: <condition>". `turnsEvaluated` goes up by one.
  5. **met** or **impossible**: the state becomes `achieved` or `failed`, and an `app.goal_verdict` row shows it. No more turns.
- **Restart**: at startup, every thread with an active goal that is idle and has no live work, or that has `judging` set, is judged again. A continuation from before the restart has the same requestId, so it is not sent twice.
- **A run** for the judge and the no-tool count is the entries after `runStartEntryId`, the first entry of the run (a user input, a continuation or a notification). `app.goal_verdict` rows are not runs of their own.
- **Safety stops** (as in Claude Code):
  - When 3 runs in a row use no tool, the goal is paused and stays set. The user resumes it by sending a message, or by `/goal` with the same condition.
  - Errors, in the run or in the judge, follow the doc. An auth error, no credits, no such model, or a context overflow that compaction cannot clear clears the goal with a notice. A rate limit or usage limit pauses it. Transient errors (overloaded, dropped connection) retry 3 times with backoff, then pause.
  - There is no turn, time or cost cap of its own. The help text says to put one in the condition ("or stop after 20 turns"), as Claude Code does.
- **Check-ins** (as the doc): when the thread is idle only because subagents or processes are running, check-in runs start after 30 minutes, then 1 hour, then 2 hours (at most 4 times the first interval). There are at most 3 idle check-ins between user messages; a user message resets the counter (kept in the goal record). A check-in that is due when a run ends with work still running is delivered at that run end. `TAU_GOAL_CHECKIN_MINUTES` changes the interval, and `0` turns check-ins off. Judge retries do not depend on it. The check-ins use the MVP8 timer scheduler (owner C's `scheduler` API, through an interface fixed in the Foundation).
- **Setting a goal while busy**: the directive is queued as a follow-up (`whenBusy: "followUp"`), and it runs when the current run ends. Setting or clearing a goal also drops any verdict that is in flight (the stale check).
- **UI**:
  - A "◎ Goal" chip in the thread header and the composer, with states active, paused, achieved and failed. Its popover shows the status fields and has a Clear button.
  - The sidebar avatar gets a small target badge while a goal is active. The fork badge is on the bottom left and the clock badge is on the bottom right, so the target badge goes on the top right.
  - Each verdict is a compact transcript row, "Goal check: not met — <reason>", with the reason expandable.
- **Relation to the other features**: `/loop` repeats on a time interval; `/goal` continues until a condition is met. Both can be active. tau is always yolo, so there are no permission prompts to remove.

## 6. UI

- **Notification rows**, one component per kind in its own file (Foundation stubs them): monitor event (lines in a `<pre>`, collapsed after 5; "no output" for 0 lines; the end state), process exited (code plus tail), timer fired (the prompt), notice (one line).
- **Thread header chip** "⏱ 2" when the thread has timers. Its popover lists each timer (schedule, next run as relative time, times fired, prompt) with Delete. It has loading and error states; a timer deleted elsewhere drops out live.
- Timers fired on a failed thread wait in the queue, shown by the existing queued-message UI.
- **Sidebar**: a clock badge on the bottom-right of the avatar when the thread has a timer; tooltip "Next wake-up in 4 min".
- Monitors show in the existing processes UI with a "monitor" label.
- Built from `components/ui` (Popover, Badge, Tooltip).

## Protocol

- `ConversationSummary` += `agentThinking`, `timers: number`, `nextTimerAt: string | null`.
- `ProcessInfo.kind: "process" | "monitor"`.
- `Timer` schema; `Core.timers.list(conversationId)`, `delete(id)`, `loop(conversationId, input)`, `stopLoop(conversationId)`; routes `GET /conversations/:id/timers`, `DELETE /timers/:id`, `POST /conversations/:id/loop`, `DELETE /conversations/:id/loop`. MVP7's command table adds `timers list|delete|loop|stop-loop`.
- Entry data schemas for the new kinds.
- `Goal` schema and `Core.goals` (`set`, `get`, `clear`); `GET/PUT/DELETE /conversations/:id/goal`; `ConversationSummary.goal: { state, condition } | null`; the command table adds `goal set|show|clear`.
- Run-end signal: `StatusTracker.onRunEnded` gets `{ conversationId, outcome, runStartEntryId }` (Foundation, with a pin test that a user Stop is `aborted`). Also `hasLiveWork(conversationId)` and the scheduler interface (Foundation).

## Phases and owners

0. **Foundation**:
   - protocol: schemas, `Core.timers`, routes, entry shapes, `ProcessInfo.kind`;
   - the fake core and the contract tags `timers` and `monitors`;
   - `NotificationSubmitter`, refactored out of the subagent path, with tests;
   - registry entries and tool stubs;
   - one stub file per prompt section and per notification row;
   - the scheduler clock interface;
   - an e2e helper that restarts the server on the same home;
   - a pin test: the same `requestId` is a no-op across a restart.
   Done when check, test and build pass.
1. Parallel:
   - **A: Effort** owns `harness/tools/agent*.ts`, `harness/subagent-runtime.ts`, `harness/conversation-child.ts`, `core/src/agents/**`, the agent card and the child header.
   - **B: Monitor + exit** owns `core/src/processes/**`, `harness/tools/process-*.ts`, `harness/tools/monitor.ts`, its prompt section, and the monitor, exit and notice rows.
   - **D: Goals** owns `core/src/goals/**`, `core/src/goals-api.ts`, the judge prompt, the web `/goal` handler, the goal chip, the avatar target badge and the goal verdict row.
   - **C: Timers + /loop** owns `core/src/timers/**`, `harness/tools/{schedule-wakeup,schedule-repeat,timers-list,timer-delete}.ts`, its prompt section, `core/src/timers-api.ts`, the web `/loop` handler, the timers chip, the avatar clock badge and the timer-fired row.
2. **Integration**, then e2e.
3. **Verify for real** in the browser: a subagent at low effort shows "· low"; a monitor on `tail -f` of a file you append to; `/loop 1m` fires twice; a wake-up survives a tau restart.

## Testing

- Goals (with a scripted fast model):
  - set starts a turn; set while busy queues a follow-up;
  - a user Stop pauses and does not continue;
  - a stale verdict is dropped when the user sends a message during the judge call;
  - a restart while `judging` judges again with no double continuation;
  - a malformed judge answer gets a retry, then pauses;
  - the transcript budget;
  - `not_met` continues with the reason; `met` and `impossible` stop and record the state;
  - a run with a running subagent skips the judge;
  - 3 runs with no tool use pause the goal;
  - judge errors: the clear cases, and retry 3 times then pause;
  - check-ins: fake clock, at most 3;
  - a restart keeps the goal and its counters;
  - the requestId dedupes a continuation;
  - `/goal` status fields; the clear aliases;
  - the CLI `goal` commands;
  - subagents cannot set a goal.


- Effort: inherit, explicit, frontmatter `thinking` and `effort`, clamp, fork.
- Monitor: the line splitter across chunks, stdout only, batching, the 20-line cap and the dropped count, the noise guard, the end event, the restart notice.
- Exit: notifies on a natural exit; not on `process_stop`, the UI Stop or reaping.
- Timers, with the fake clock:
  - next runs; a one-shot missed while down fires once;
  - a repeat down for 3 days fires once, then keeps its schedule;
  - coalescing while the thread is busy (followUp), through `lastFireRequestId`;
  - the 7-day expiry;
  - no fire after delete or archive; a delete between the check and the submit removes the timer;
  - `app.timer_fired` is `queued` while the thread is busy (pin test);
  - a crash between the submit and the counter commit: the restart submits the same requestId (a no-op) and the counter moves;
  - `scheduler.close()` waits for an in-flight fire;
  - subagents do not get the tools.
- `/loop`: `every` parsing, the first run now, the dynamic instruction, `stopLoop`, the CLI command.
- e2e (faux): `/loop` with a short test interval (test-only clock speed); a monitor event row appears; the chip shows the timer and Delete removes it; a wake-up fires after a server restart.
