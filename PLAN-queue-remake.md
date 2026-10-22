# PLAN: queue/steer/bang remake

Created 2026-10-21. Goal: while the agent is busy, queuing, steering,
`Send now`, `!` commands and machine notifications behave predictably — no
silent loss, no double execution, no blank transcript, no manual queue-pumping
to unstick the thread.

Reference design: pi-coding-agent 1.3.0 (in our `node_modules`;
`@earendil-works/pi-coding-agent/dist`). pi is a single-process TUI, so we
borrow its **contract and UX**, not its implementation — the durable inbox and
live sync stay. Evidence for every failure is file:line; pi paths are
`pi/dist/...` under that package.

## Failure catalog (all verified)

- **F1 — bang double-executes by design.** `sendOnce` admits raw `! cmd` text
  as `pi.user` (`core/src/conversations-api.ts:110-133`,
  `conversation-input.ts:49-70`; `conversation-store.ts:259` keeps the verbatim
  `!` prefix) **and** `runBangCommand` spawns it server-side
  (`bang-command.ts:83-117`, "Awaits `start` only — never the exit"). Agent
  re-runs what the backend already ran; exit output arrives separately as a
  queued `followUp` (`notification-submitter.ts:28`). pi does the opposite:
  `!` bypasses the message system (`pi/dist/modes/interactive/interactive-mode.js:2690-2702`),
  runs via `session.executeBash` with live output, records a
  `role: "bashExecution"` entry — deferred to turn end if streaming, appended
  if idle (`pi/dist/core/agent-session.js:3129-3183`). `!!` is
  `excludeFromContext`.
- **F2 — Send-now loses the message.** `stopAndRestore` aborts (withdrawing the
  item), then `send` (`web/.../queue/QueuedItemActions.tsx:59-66`); on `send`
  rejection `attempt` only toasts (`:32`) — restore covers `others` only
  (`stop-restore.ts:17-21`).
- **F3 — double-click double-admits.** No pending guard on queued-item buttons
  (`QueuedItemActions.tsx:74-96`); each click mints a new `requestId`
  (`sendInputOf :22-29`), defeating `submitOnce` dedup
  (`conversation-submit.ts:9-16`).
- **F4 — a notification can steal the idle slot.** Between abort and resend,
  any `notifications.notify` (`process-service.ts:247-252,290-300`) starts a
  run on the now-idle thread; the Send-now message queues behind it.
- **F5 — finished calls vanish mid-turn.** `runningCallsWithoutEntry` consumes
  the streaming block for done slots then skips them (`Transcript.tsx:100-108`);
  entries commit at run end, so each row blinks out on finish. Branch test
  (`Conversation.test.tsx:132-148`) pins only the running case.
- **F6 — notification XML lands in the composer.** `QueuedMessages.tsx:26-31`
  gives notification items the same actions; `cancel` unconditionally
  `restoreToComposer`s (`QueuedItemActions.tsx:41-47`).
- **F7 — attachments dropped.** `QueuedMessage` is text+images only
  (`protocol/.../live-info.ts:16-21`); every action rebuilds text+images
  (`sendInputOf`, `restore.ts:25-31`). Queued files vanish silently.
- **F8 — no heartbeat, stale view looks alive.** No ping/pong
  (`server/.../register-live.ts`, `connection.ts`); half-open TCP never fires
  `onClose`; server drops to closed sockets (`connection.ts:51-53`); no op
  sequence numbers (`watch-conversation.ts:15-25`); only a *throwing* op
  triggers `resync` (`create-live-client.ts:93-101`). Most probable mechanism
  behind "tools appeared only after the next message".
- **F9 — dead watcher, silent subscription.** Non-AppError from `watch` only
  logs (`connection.ts:82-84`); client never gets `RETIRED_OPS`, never resyncs.
- **F10 — steer that doesn't steer.** Steers land at postTools boundaries only;
  during final-answer streaming or approval-pending it sits labeled
  "Steering" (`queued-mode.ts:4`) while behaving as follow-up.
- **F11 — mode change reorders.** `changeMode` withdraws + resends with a new
  requestId = new submission id = back of inbox (`QueuedItemActions.tsx:50-56`).
- **F12 — composer mislabels.** Hardcoded "Send as steer"
  (`Composer.tsx:~393`) even when effective mode is followUp
  (`Conversation.tsx:89`).
- **F13 — orphan rows mislead.** Fallback appends after `items` (wrong position
  vs later user bubbles) with synthesized empty args (`Transcript.tsx:119-121`).
  Partially softened on-branch (McpTool `?/?` guard); position remains unknown
  — slots carry no insertion index.
- Small but in-scope: `Escape` aborts the run (`Composer.tsx:~244`,
  one mis-key kills run+queue); steer-mode button on a steer item is a silent
  no-op (`QueuedItemActions.tsx:51`).

pi queue facts we adopt: `prompt()` **requires** an explicit
`streamingBehavior` while streaming — throws otherwise
(`pi/.../agent-session.js:1637-38`); `steeringMode/followUpMode: all |
one-at-a-time`; queue UI is dim `Steering:/Follow-up:` lines + **one**
`dequeue` action restoring *all* queued to the editor, abort optional
(`app.message.dequeue`, `restoreQueuedMessagesToEditor`); queue auto-drains
after the run, in order. pi punts true mid-answer interruption too — we match
that and fix the labeling instead.

## Release 1 — bang contract (kills F1)

1. **R1.1 `!` never reaches the model as text.** Admit `! cmd` as a
   display-only `app.bang` entry (display-only writes settle immediately
   while busy; unknown kinds are skipped safely by view-text and transcript),
   spawn the process as today. The model learns the result from the
   `process-exit` notification only. `!!` keeps current behavior (literal
   text, no spawn). The admission must replicate `store.send` side effects
   the raw `write` submit would skip: title from the stripped command,
   `updatedAt`, unarchive. It must cover **both** entry points — `sendOnce`
   *and* `startOnce` (today a first-message `! cmd` is admitted as text and
   **never spawned**; the start path goes through `conversation-start.ts`
   `admitFirstInput`, which submits the input as model input and stashes the
   original text as the pending first input — both must learn the bang
   branch, including start retries and title creation).
   Crash window (admit-then-spawn): admission before spawn means a crash in
   between leaves an accepted bang a deduped retry will never execute.
   Close it with a durable `dispatched` marker written **before** spawning
   (at-most-once): on boot, re-dispatch only bangs with **no** marker; bangs
   with a marker but no exit get an "interrupted by restart" notice
   (extend the restart notice beyond monitors). Never match on "no process
   record": finished processes leave no rows (`pruneEntry` deletes records,
   `reapStaleAtStartup` clears all, `pruned` is memory-only), so that
   predicate matches every bang ever run and the sweep would re-run history.
   Display contract, decided: bang rows are **not** rewind anchors and are
   **not** turn boundaries (rewind keys off `pi.user`; fork drops later
   entries as today); they render as display rows inside the surrounding
   turn, `TurnChanges` anchoring on user entries stays exactly as is, and
   checkpoint resolution must handle the `app.bang` entry kind like other
   notice kinds (specified at contract freeze).
   Files: `protocol` (new kind), `core` input/api/bang/store, web transcript
   row. The process model distinguishes only `process`/`monitor` today —
   define and persist an origin/source field (`StartProcessRequest`,
   `ProcessInfo`, exit schema), set it in `runBangCommand`, and select the
   model-bearing write vs follow-up delivery by origin. Test: `! echo hi`
   while busy → exactly one execution, one output, no `pi.user` entry
   containing `!` in model context; first-message `!` spawns; bang vs
   monitor exits take visibly different delivery paths.
2. **R1.2 one-at-a-time guard, reserved under a per-conversation lock.**
   `sendsInFlight` is keyed by requestId, so two sends with different ids
   both pass the check before either spawns. The guard must reserve **before
   admission** under a per-conversation lock (same lock as R2.1). Refusal =
   rejecting the REST send (`invalid_request`) with **no** `app.bang` row
   admitted — otherwise the row exists and the boot sweep from (1) runs it.
   Never refuse via notice notification (it would queue behind the busy run
   and look like the command ran). Composer catch restores text+attachments.
   Scope: bang-kind processes only; monitors run concurrently by design.
   Test: two rapid `! sleep 5` with different requestIds → one runs, one
   inline error, typed text preserved, no orphan row; a new bang succeeds
   after the first exits (slot held until exit, spawn failure, or restart
   recovery — never released at spawn return).
3. Exit record that keeps context, no turn when idle. The `process-exit`
   text must carry the command and that the user ran it
   rendered text omits it: prefix model text with "You ran: <command>"
   plus user origin. Bang exits submit a model-bearing `type: "write"`
   entry — Pi Durable appends it without starting a turn when idle and
   queues it to a boundary when busy (this is what "matches pi" requires;
   a `followUp` input to an idle thread starts a run, which pi never does).
   Preserve `followUp` for all other process notifications. A bang killed by
   restart gets the interruption notice from (1) — extend restart notices
   beyond monitors. Skip the `snapshotBefore` checkpoint for bang sends
   **and** bang `startOnce` admission/retries
   (`conversations-api:114,169-170`, `conversation-start:61-74`) — nothing
   will ever anchor it.
   Tests: exit text contains the command; idle `!` never starts a run;
   restart-interrupted bang posts the notice, never replays.

## Release 2 — atomic queue actions (kills F2,F3,F4,F6,F7,F11)

1. **R2.1 server-side `sendNow(conversationId, itemId)` RPC.** One operation.
   Order: **read `InboxDoc` first** (snapshot user contents — submission
   records keep no content, so capture must precede the abort that
   withdraws them; withdraw+re-read in one commit is not expressible, only
   `InboxDoc` is exported), then abort, then withdraw user-only items, then
   admit the chosen item with server-supplied content and **server-minted
   requestIds**. Serialize against **all** submissions via a per-conversation
   lock around every submit path (`send`/`retry`, `notify`, timers,
   `goal-service:378`, `subagent-reporter:57`) — not just notification
   delivery — since `abort` and `submit` are separate durable commits and
   the delivery chain can land between them. One shared per-conversation
   admission gate: `sendNow` holds it across snapshot → abort → re-admit
   using an explicitly unlocked admission helper; ordinary submitters hold
   it only through the `conversation.submit` admission, never
   `Submission.wait` or delivery-chain completion.
   (never reuse the withdrawn submission's id: the requestId mapping is never
   cleared, so re-admission under a known id is a silent no-op). Awaited in
   order. No client `requestId` regeneration, no localStorage restore.
   `sendNow` — and the shared abort helper — return the snapshotted user
   items (text plus FileRefs resolved through the requestId sidecar), so
   every composer-return path (Stop, Send-now's unselected items, Cancel)
   restores from the server snapshot post-success, never from the client
   draft alone (which lacks refs and races the withdraw). Keep the restore
   post-success, not optimistic: the composer updates only after the server
   confirms what survived.
   Manual snapshot-and-withdraw via public `InboxDoc`/`Tx.doc`/
   `Tx.settleSubmission` is possible — the actual limitation is that no
   public API combines such a transaction with `Conversation.abort()`'s task
   cancellation/wait, hence read-before-abort plus the gate below, not a
   single commit. The plain-Stop path (`conversations.abort` + composer
   restore) shares one internal abort helper with `sendNow`: under the gate
   it snapshots queued items, aborts, then re-admits non-`pi.user` items with
   new requestIds — `sendNow` additionally admits the chosen item first, so
   user content always lands ahead of re-admitted notifications. Filtering
   notifications out of the composer restore without this would lose them
   (abort withdraws them; the composer snapshot is their only other copy).
   Steal-window claim downgraded honestly: `abort` and `submit` are separate
   durable commits and the notification delivery chain can land between them,
   so either serialize `sendNow` against that chain in core, or document the
   window as shrunk to intra-process. New `POST
   /api/conversations/:id/send-now` + `Core.conversations.sendNow`. Client:
   single call + one busy flag disabling all queued-item buttons while any
   action is in flight. Client optimism here is limited to that instant
   disable — never moving queue rows optimistically (Linear's lesson:
   ordering lives server-side; abort/withdraw/re-admit may not honor a
   faked order).
   Tests: double-click → one admission; notification raced between abort and
   admit → user message still wins (deterministic interleaving via the
   real-harness pattern — `sendNow` must expose its steps or a test hook);
   abort while a process-stop awaits notification delivery;
   timer/notify/goal/reporter interleavings under the gate; send-failure →
   **durable rollback**: withdrawn user items are re-admitted with new
   requestIds so the item stays in queue UI (never draft, never lost);
   `sendNow` during retry backoff.
2. **R2.2 notifications survive abort server-side; kinds travel with the
   queue; text matching is dead.** Core abort (shared helper) snapshots
   queued items under the gate, aborts, re-admits non-`pi.user` items with
   new requestIds; `stopAndRestore`'s composer snapshot hence covers user
   items only. `QueuedMessage` carries the normalized
   `entryKind` (`item.entry?.kind ?? "pi.user"`, small protocol addition)
   and every user-only op — client and server — keys off it; all
   `isNotificationText` checks are removed. `sendNow` validates the item
   against that conversation's inbox and **rejects notification items**
   (client hides their actions; server validates); `cancelQueued` passes
   `conversationId` (`abortSubmission` takes one; omitting it lets any item
   id cancel on any thread — existing bug, fixed here). Plain-`pi.user`
   goal directives follow the `pi.user` policy. Tests: abort with queued
   process-exit → still queued, never in draft; Stop restores only user
   text; Cancel/Send-now on a notification id rejected; cross-thread cancel
   rejected.
3. **R2.3 files: no protocol change for Send-now, refs ride Cancel's
   response.** Files are not dropped — admission flattens refs into text
   blocks (`conversation-input.ts:60-68`) and `queuedText` joins them, so a
   server-side Send-now re-admitting `item.content` as-is preserves files
   with **no** protocol change (a durable user item carries only `content`;
   entry kinds can't carry data — do not add `files` to `QueuedMessage`).
   Every composer-return path — Cancel, Stop, and Send-now's unselected
   items — needs the original refs; all three use the same requestId-keyed
   sidecar (response shapes in the freeze). Re-admitting the selected
   Send-now item needs no FileRef because its content already carries the
   file path. No side document beyond the sidecar.
   Test: stage → queue → Send-now preserves the file; Cancel returns refs
   and restores them to the composer; Send-now with an unselected queued
   item containing a file → file back in the composer post-success.
4. **DROPPED — per-item mode change (cheapest cut).** R3.2's Cancel-only rows
   make it moot: mode is chosen at send time via the keybind. Do not build
   `setQueuedMode` (in-place edit is possible via `InboxDoc`/`Tx.doc` but
   bypasses boundary invariants and must skip `mode:"write"` items; the
   withdraw+resend fallback re-triggers the requestId trap for every item).

## Release 3 — honest states (kills F5,F10,F12,F13 + smalls, web+protocol)

1. **R3.1 done slots render via the slot until the entry commits** (symptom
   mitigation; the root cause it papers over is R4's silent-watcher gap
   below). Extend the orphan fallback: any slot (active *or* done) with no
   committed entry renders from slot status/output; consumed streaming
   blocks never linger. Position caveat stays documented (slots have no
   index).
2. **R3.2 inbox UI split.** "Up next" (followUp) / "Will steer" (steer),
   Cancel only per **user** item; notification rows render with **no
   action buttons** (nothing user-meaningful can be done with them;
   Cancel/Send-now on a notification id is rejected server-side). No
   per-item mode buttons.
3. **R3.3 truthful composer.** Label reflects effective mode; `Escape` no
   longer aborts (drop it); while awaiting approval the composer yields to the
   approval bar's own reply affordance — the **sole** reply path, no steer
   affordance while approval is pending (a steer there would wait for the
   post-approval boundary anyway; copy must never imply immediacy).
4. **R3.4 steer honesty copy.** "Delivered at the next tool boundary";
   steer affordance hidden (not faked) whenever it cannot act promptly. No
   new `interrupt` semantics — matches pi, kills the lie.
5. **R3.5 optimistic list mutations (web-only, no protocol change).** The `ThreadRow`
   archive/remove/rename actions (`ThreadRow.tsx:89-101`) await the REST
   round trip and *then* invalidate — the row lingers for seconds. Standard
   TanStack pattern (`onMutate`: cancel in-flight queries + snapshot +
   `setQueryData`; `onError`: rollback + toast; `onSettled`: invalidate
   **only when no sibling mutation is still in flight**
   (`queryClient.isMutating({ mutationKey: ['threads'] }) === 1`, TkDodo's
   concurrent-mutation guard — rapid archive→rename→remove must not flash
   old UI). One shared `mutationKey` for all sidebar/palette list
   mutations. Optimistic transforms stay trivial (move/remove/rename in
   place — never re-sort or recompute filters client-side). Applies to every
   sidebar list mutation (archive/unarchive/remove/rename, palette
   `ThreadActions` toggles): the row moves/disappears/renames instantly —
   same lag reported for thread renames, same fix.
6. **R3.6 optimistic composer send (chat tempId pattern, keyed by id).**
   The composer clears on submit but the bubble only returns after the
   server round trip + live ops — the message visibly vanishes for a second.
   Fix: `send`/`sendNow` return `{ submissionId, entryId? }` (duplicate
   requestIds return the existing receipt; small protocol + route change —
   `send` returns `void` today), and the pending bubble (status `sending`)
   is keyed by it: a queued row matches by exact submission id, a placed
   bubble by entry id — never by text or entry-count (re-admits, boundary
   placements and goal directives all create lookalike entries that resolve
   the wrong bubble). Queued while busy → the bubble morphs into the queued
   row instead of vanishing. Failure marks the bubble `failed` with retry,
   never silent vanish. Reconcile must never clobber newer live state
   (Chatwoot #16351 rule: compare before swapping). Never mutate cached
   live data in place — always set new objects.

## Release 4 — live sync you can trust (kills F8,F9)

1. **R4.1 heartbeat + sequence numbers.** Server `ping` every 30s; client
   treats missed pongs / 2×interval silence as close (existing reconnect path
   handles it). Per-conversation op sequence; gap → existing `resync`.
   Files: `protocol/live.ts`, `server/.../connection.ts`,
   `web/.../create-live-client.ts`. Tests: fake transport killed without close
   frame → `reconnecting` + fresh base; skipped sequence → resync.
2. **R4.2 watcher failure is always terminal and visible.** `startWatching`
   failure sends `RETIRED_OPS` or a new error frame, never silent — and
   deletes the dead subscription from the map (today a failed subscribe
   leaves it mapped, so every later subscribe is a no-op and even a client
   resync cannot recover on that socket). Expose and monitor
   `watch.closed`: a `listener_error`/`session_failed` ends ops delivery
   while socket and pongs stay healthy — the most likely real mechanism
   behind the original repro, since overflow never drops frames and REST
   sends never touch the socket. On watcher close, remove that exact
   subscription and send a distinct watch-failure frame that triggers
   client resubscribe + fresh base. Test with the socket still healthy.
   Prerequisite: log conversation id + the bad op/frame and reproduce the
   original case before building R3.1 or R4.

Keep, don't touch: requestId dedup, pi-durable steer-at-boundary, plain Stop +
`stop-restore` for user text, on-branch live-client hardening, orphan fallback
shape. `!!`/exclude-from-model-context needs durable context filtering —
deferred, open risk. Interrupt-mid-answer steer — decided no.

## Verification

Must-keep-green: `conversation-submit.test.ts`, `queue.test.tsx`,
`stop-restore.test.ts`, `create-live-client.test.ts`, `Conversation.test.tsx`,
`process-service` + `mvp5/6-pins` suites (verified bang-free).

Tests that encode the bad behavior and must change: `queue.test.tsx:89`
(client abort+resend) and `:71` (withdraw+resend reorder) → replaced by
atomic-RPC contracts; `bang-command.test.ts` → `:437` verbatim-`!`-storage and
`:247` spawn-and-title-for-admitted-winner encode exactly what R1.1 deletes;
`stop-restore.test.ts` += notifications never restored, files survive;
`Conversation.test.tsx:132` += done-slot-without-entry renders; R3.5 +=
archive/remove/rename moves the row instantly and rolls back on failure
(incl. concurrent-mutation guard: spam-click shows no flash of old UI);
R3.6 += pending bubble keyed by returned submission/entry ids, swaps on
exact-id match, `failed`+retry on send failure, never clobbers newer state;
R1 += dispatched-marker at-most-once + restart cases (completed-and-pruned
bang never replayed; unmarked dispatched once; marked-without-exit gets the
interruption notice); lock-serialization interleavings incl. goal/reporter/
timer paths; cancel cross-thread rejected; exit text contains the command;
idle-no-run; checkpoint skipped on both bang paths; R4 += watch.closed
failure frame with healthy socket + dead-subscription cleanup.

Testability seams (build them): `sendNow` exposes steps or a hook for
real-harness interleaving tests; heartbeat tests need injectable timers in
`create-live-client` (currently hardcoded `reconnectDelayMs` import).

New per release: R1 one-execution + refusal cases, dispatched-marker
at-most-once + restart cases (completed-and-pruned bang never replayed,
unmarked dispatched once, marked-without-exit gets the notice), exit text
contains the command, idle-no-run, checkpoint skipped on both bang paths,
origin-selected delivery paths differ; R2 double-click, raced notification,
gate interleavings incl. task/agent-wait child submits, failure-restore,
files-preserved, cancel cross-thread rejected + returns refs; R3 done-slot
render, approval-pending composer, steer copy states; R4 heartbeat-timeout
and sequence-gap on fake transports, watch.closed failure frame with healthy
socket + dead-subscription cleanup. E2E (built CLI, Playwright): queue two while
busy + Send-now second → immediate, first back to composer, no dupes, no blank
tool rows; `! echo hi` while busy → one execution, one output. Manual: the two
original user repros.

## Ownership (parallel execution)

Contract freeze first (one foundation agent): protocol kinds/routes
(`app.bang`, `sendNow` + `{submissionId, entryId?}` receipts on send/send-now,
`entryKind` on `QueuedMessage`, user-item snapshots with FileRefs on the
abort/send-now/cancel responses, process origin/source field, watch-failure
frame, `ping` frames, sequence numbers)
+ fake/testkit stubs. No `files` on `QueuedMessage` (R2.3 needs none).
Then parallel: core R1/R2
(owner: `core/src/harness/{conversation-store,conversation-submit,conversation-start,notification-submitter,subagent-reporter}.ts`,
`core/src/harness/tools/{task,agent-wait}.ts` (child submits go through the
gate keyed by target child conversation ID),
`core/src/{conversation-input,bang-command,conversations-api}.ts`,
`core/src/processes/` directory, `core/src/goals/goal-service.ts`),
protocol + route owners (`core/src/conversation-input.ts`,
`protocol/.../mvp8.ts`, `protocol/.../live.ts`, `protocol/.../core.ts` +
`rest.ts`, server send-now route, `server/.../live/connection.ts`), web
R2-client/R3 (owner: `web/src/conversation/{queue,messages,model,tools/ToolCall,Composer,Transcript}.tsx`),
live R4 (above protocol/server files + `web/.../create-live-client.ts`).
Integrator merges per release with check+test each time; verify for real in
the built app.
