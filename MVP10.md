# MVP10 plan: Claude connectors in Claude CLI threads

Status: APPROVED v6 (review rounds 1–5 applied). Builds on MVP9 (Claude CLI provider, architecture A) and the spike `scratchpad/connectors-spike/notes.md` (CLI 2.1.302, SDK 0.3.302, 5 Haiku turns, read-only).

## Goal

> In a Claude CLI thread, the agent can use the MCP servers my `claude` login has: my org's claude.ai connectors (Linear, Slack…) and my own `claude mcp` servers. I pick which ones in Settings. Tools that write ask me first.

## Scope

In:
1. **Connector list** in Settings → Tools, section "Claude connectors": every server from `mcpServerStatus()` with its state (connected, needs auth, failed, disabled) and tool count. A switch per server. Default: off.
2. **Connector tools in Claude CLI threads**: the CLI runs them; tau shows each call as a normal tool card with its result.
3. **Approval** for tools that are not read-only: an inline card in the thread with "Allow once", "Always allow this tool", "Deny". Read-only tools (MCP `annotations.readOnly`, `sdk.d.ts:1263-1300`) run with no prompt.
4. **Own `claude mcp` servers** (user scope), if pin (m) shows a safe way to load them.

Out (later): connectors in threads on other providers; logging in to a "needs auth" connector from tau (the user does it on claude.ai); claude.ai connectors on a remote runtime; per-project connector sets.

Changes to MVP9 conditions: "Every SDK query sets `strictMcpConfig: true` and `disableClaudeAiConnectors: true`" becomes "…unless the user turned on at least one connector; then only the chosen servers' tools are allowed (`allowedTools`), everything else is denied by `dontAsk`". The other conditions stay (no tokens, no "Claude Code" text, kill switch, personal use).

## Evidence (spike)

- Open query: 52 servers (51 `claudeai`: 15 connected, 37 needs-auth), 600 tools, all loaded (not deferred). Connectors connect 2–4 s after start; a first request before that misses them; one run stalled ~20 s.
- A connector call is one API message ending `stop_reason: tool_use`; ~0.5 s later the CLI emits a `user` `tool_result` (`tool_use_result: true`) and starts the next message by itself.
- Mixed message (tau tool + 2 connector tools): blocks in that order; after tau's handler resolved, results arrived tau first, then connectors. Turn ended correctly. Concurrency unproven.
- No SDK API calls an MCP tool without the model. `mcpServerStatus()` gives `name`, `status`, `source: "claudeai"`, `tools[]`; `toggleMcpServer(name, enabled)` exists.
- Under `dontAsk`, tools not in `allowedTools` are denied (`is_error` result, `system/permission_denied`).
- pi-ai 1.3.0 has no "provider-executed" tool call flag.

## Design

### Query options

- No connector on: unchanged (MVP9 locked-down options).
- One or more on: `strictMcpConfig: false`, `disableClaudeAiConnectors: false`, `permissionMode: "default"` (not `dontAsk`: under `dontAsk` the CLI denies unlisted tools without asking, spike item 6), `allowedTools: [mcp__tau__*, …read-only tools of chosen servers, …always-allowed tools]`, and a `canUseTool` callback (`sdk.d.ts:228`: gets `signal`, `toolUseID`, `mcpServer { name, source }`) that (1) denies at once when `mcpServer.name` is not a chosen server, (2) allows when the tool is in the always-allow store (`allowedTools` is fixed per query, so a new "Always allow" takes effect through this check), (3) asks the user for the rest (pin n). Permission prompts have no park deadline (`sdk.d.ts` ~225). `tools: []` stays, so no built-in tool can reach `canUseTool`. Servers that are not chosen are switched off with `toggleMcpServer(name, false)` right after init (pin o), so their schemas do not fill the context.
- **Wait for connectors**: before the first input of a new query, poll `mcpServerStatus()` every 250 ms until no chosen server is `pending`, cap 5 s. On timeout the turn goes on; the status note says which servers were late.

### Observed tool calls (the core change)

A connector `tool_use` is a call that Pi must show but not run.
- **One generic Pi tool**: Pi Durable resolves calls with `agent.tools.find(name)` over tools fixed at extension definition (`pi-durable/dist/tool.js:133-136`, `agent.js:63`); there is no per-conversation registration. So tau defines **one** static tool `claude_connector` with arguments `{ server, tool, arguments }` in a new harness extension (`core/src/harness/tools/claude-connector.ts`). It is offered only in Claude CLI threads with at least one connector on (`AgentDoc.tools` selects names). No dynamic names, no 64-character mapping.
- **Mapping**: the adapter turns a CLI `tool_use` `mcp__claude_ai_<Server>__<tool>` into a Pi `ToolCall` `claude_connector({ server, tool, arguments })` with the same id, and back (`core/src/claude-cli/connectors/names.ts`, frozen in Phase 0, shared by A and B).
- **Execute**: `claude_connector.execute()` awaits an **observed result** deferred keyed by `toolUseId` and returns the CLI's result **unchanged** (same text, images and `isError`; no truncation), so the transcript hash stays stable across calls.
- **Pump**: a CLI `user` `tool_result` whose id is a connector call never goes to `binding.listener.feed`; it resolves (or creates, already resolved) the observed deferred, so it works whether it arrives before the Pi `ToolCall` exists, during the stream, or after the stream ended with no listener.
- **Inbox**: after a connector-only message the CLI starts the next API message by itself, before Pi calls `streamSimple` again. Today `dispatch` drops messages when `binding.listener` is null (`pump.ts`). New: the binding keeps an `inbox`; with no listener, every non-system message (stream events, `assistant`, `result`) is queued, and the next turn's listener drains the inbox before live messages. That next Pi stream is that next API message (one Pi stream = one API message still holds). `result` and `owedResults` bookkeeping read from the drained messages the same way.
- **Delivery**: the binding keeps `connectorIds` (a set). `resolveDeferreds` skips those ids **entirely** (today a result not in `binding.expected` goes to `asText` and would be sent as user text, `deliver.ts`). Connector ids are never in `binding.expected`, so `hasUnansweredCalls` ignores them. The results still count in the hash. Same rule in the Resume and Resume-at paths; Rebind renders them as transcript text.
- **Hash**: `claude_connector` is left out of the system-message key in `normalize.ts` (tools added/removed), so turning the first connector on or off does not force a Rebind by itself. A change of the chosen server set closes the live query; the next call takes the **Resume** path with the new options (same SDK session).
- **Adapter invariants** (review round 3, owner B):
  1. The inbox drains **one API message** per turn (up to and including its `message_stop` and `assistant`) and keeps the rest queued (`turn.ts:41-43`, `api-message-reader.ts:195` ignore anything after the first message). `closeQuery` clears the inbox (`lifecycle.ts:17`).
  2. One consuming rule for `result`: when a `result` arrives with no listener **or with a settled listener** (`isSettled()`), it is not queued and not fed; it sets `binding.resultSeen = true` (`pump.ts:37-41`). `settleAfter` (`run-bound.ts:44-45`) adds an owed result only when `resultSeen` is false, and then clears it. A queued `result` therefore never reaches a later turn (`turn.ts:45`).
  3. `settleAfter` filters connector ids out of `summary.toolUseIds` before adding to `expected` (`run-bound.ts:44`).
  4. Continue (`deliver.ts:19-25`), Resume and Resume-at (`prepare.ts:34-50`) filter `claude_connector` results out. With a live query and an empty suffix after the filter, no user message is sent and the turn only reads (inbox or live). With **no live query** (Resume after a close or crash) and an empty suffix, the CLI's own next message may be lost: the Resume sends the user text "Continue." **only when the SDK session's last message is a connector `tool_result`** (else it Rebinds) (`launch.ts:59` always pushes input; the resumed SDK session already holds the connector results).
  7. **Busy**: `isBusy` (`lifecycle.ts:66-67`) also counts open connector ids, a non-empty inbox and pending approvals, so the 15 min idle close and invariant 6 never close a query that owes a CLI-started message.
  8. **Stop**: `claude_connector.execute()` listens to its abort signal and calls the adapter's `interruptConversation(sessionId)` (a port that owner B exposes and owner A calls), which runs `interruptAndSettle`. As a backstop, new code in `deliver.ts` interrupts when the next call carries an aborted connector result (`normalize.ts:36-37`; today `deliver.ts:45-46` only checks `expected`). `interruptAndSettle` becomes idempotent (reuses `binding.settling`; no second `owedResults += 1`, `lifecycle.ts:46`) and does nothing when the query has no open turn.
  5. `normalize.ts` drops a system entry whose only change is `claude_connector` added or removed, so `hasForeignEntry` (`choose-path.ts:34-43`) does not Rebind.
  6. A change of the chosen server set marks the binding "options stale"; at the next `streamSimple`, before `choosePath`, an idle binding closes its query (so `atHeadPlan` picks Resume, `choose-path.ts:42-46`, `launch.ts:70-79` builds fresh options). A busy binding is never closed for this; it waits for the next idle call.
- **Tool definitions to the CLI**: the adapter filters `claude_connector` out of the `tau` MCP server.
- **Wrong provider**: if the thread switches away from Claude CLI, `claude_connector` is no longer offered; Pi Durable already answers a stray call with `tool_unavailable` (`pi-durable/dist/harness/generation.js:466-468`). Owner D: the tool card for `claude_connector` with an error result whose text starts "Tool claude_connector is not available" shows "Claude connectors need a Claude CLI model" (new; no web code handles `tool_unavailable` today).
- **Mixed message**: tau results go to MCP deferreds (MVP9), connector results come from the CLI. Order does not matter (deferred map).
- **Abort**: Pi aborting a passthrough tool → `q.interrupt()`; the observed deferred rejects with `aborted`.
- **Rebind / Resume-at**: the rebind transcript renders connector calls and results as text (the new session never ran them). Resume-at to a checkpoint before a connector call is fine (the SDK history has it).

### Approval

- `canUseTool(toolName, input, { signal, toolUseID })` (pin n) for non-read-only connector tools. tau keeps the approval in an **in-memory side store** (`core/src/approvals/`), keyed by `toolUseId`, not in the thread document (no hash or checkpoint effect), and emits `changes.emit({ resource: "approvals", conversationId })`. `GET /conversations/:id/approvals` lists pending ones. A tau restart drops pending approvals; the CLI process is gone too, so the call ends as aborted.
- `hasLiveWork` gets a third input, `hasPendingApproval(conversationId)` (owner C edits `harness/live-work.ts`).
- The thread shows an approval card under the tool card: tool name, arguments (collapsed JSON), "Allow once", "Always allow this tool", "Deny". REST: `POST /conversations/:id/approvals/:toolUseId` `{ decision: "allow" | "allow_always" | "deny" }`. CLI command table: `threads approve <id> <toolUseId> --allow|--always|--deny`.
- "Always allow" stores the tool name in `Settings.claudeConnectors.alwaysAllow`. Deny returns `{ behavior: "deny", message: "The user denied this tool call." }`.
- While an approval is pending, the thread is busy (live work); Stop denies it and interrupts. A goal or timer turn that hits an approval waits like a user would (no auto-allow).

### Settings and status

- `Settings.claudeConnectors: { enabled: string[]; alwaysAllow: string[] }`.
- `ClaudeCliStatus.connectors: { name, source: "claudeai" | "user", status, toolCount, readOnlyCount }[] | null`, from a cached `mcpServerStatus()` probe (one short-lived query with `maxTurns: 0` or no input, pin q), refreshed on Settings open and "Check again". No tool schemas over the wire.
- Settings → Tools → "Claude connectors" (only when the Claude CLI row is `ready`): one row per server: name, status badge for non-connected states, "N tools · M read-only", switch. "needs auth" rows say "Connect it on claude.ai" and have no switch.

## Pins (real CLI, `TAU_REAL_CLAUDE=1`, read-only calls, ≤ 8 Haiku turns, required before merge)

Gates: (n), (q) and (r) run **first** in Phase 0. If (n) fails, writes are Out (only read-only tools, no approval UI). If (r) fails, every connector tool asks unless always-allowed. If (q) fails, the connector list fills from the last live Claude CLI query's `mcpServerStatus()` and Settings says "Start a Claude CLI thread to list connectors".

- (k) A connector call and a parked tau handler in one message: does the connector run while ours is parked, and does a late tau result still give a correct turn?
- (l) `allowedTools` with `mcp__claude_ai_Linear__*` glob works.
- (m) Loading user-scope `claude mcp` servers: which option does it (`settingSources: ["user"]`, `mcpServers` passthrough) and what else it loads (hooks, CLAUDE.md, permissions). If it brings hooks or CLAUDE.md, user servers are Out.
- (n) `canUseTool` is called for connector tools not in `allowedTools` under the permission mode we use, and `deny` / `allow` work; a long wait (5 min) for the user does not time out.
- (o) `toggleMcpServer(name, false)` removes that server's tools from the next request.
- (p) Pi Durable: a `ToolCall` named `claude_connector` in a thread where the tool is not offered gives an error result, not a crash.
- (q) A status probe query that never calls the model (no API usage) and returns `mcpServerStatus()`; time to all non-pending.
- (r) `tools[].annotations.readOnly` is set in `mcpServerStatus()` for Linear and Slack read tools.

## Phases and owners

0. **Foundation** (one agent): gate pins (n), (q), (r) first, then (k)–(p); results in this doc and the design adjusted per the gates. Protocol (`Settings.claudeConnectors`, `ClaudeCliStatus.connectors`, approvals list and decide routes in `rest.ts`, CLI command in `commands.ts` with the coverage test), settings store field, server routes, testkit fake core + contract tag `claude-connectors` (pending), web hooks. `claude-cli/sdk-types.ts` and `sdk-port.ts` gain `mcpServerStatus()`, `toggleMcpServer()`, the `canUseTool` option and `permissionMode: "default"`. Fake SDK: connectors in `mcpServerStatus`, CLI-executed tool results (early and late), the CLI starting the next message by itself, `canUseTool`. `connectors/names.ts` (frozen), the `claude_connector` tool definition stub and its extension, the approvals port interface, and stubs for every owner.
1. **Parallel**:
   - **A: Connectors core** owns `core/src/claude-cli/connectors/**` except `names.ts` (probe, cache, observed-result store, chosen-server settings logic), `core/src/harness/tools/claude-connector.ts` (execute), `core/src/provider/provider-service.ts` connector status.
   - **B: Adapter** owns `core/src/claude-cli/stream/**` (query options, wait for connectors, mapping in the reader, pump routing, skip delivery, `stream/errors.ts` `neutralText` over connector status errors, the `interruptConversation` port, `expected` exclusion, filter, abort, rebind text, `canUseTool` bridge to the approvals port).
   - **C: Approvals core** owns `core/src/approvals/**` and `core/src/harness/live-work.ts` (pending store, decide, always-allow, Stop denies, `hasPendingApproval`).
   - **D: Web** owns `web/src/settings/ClaudeConnectors*`, `web/src/conversation/ToolApproval*`, `web/src/conversation/tools/ClaudeConnectorTool.tsx` (label "Linear · list_teams", the `tool_unavailable` text) and the tool card registry in `web/src/conversation/tools/ToolCall.tsx`.
2. **Integration** (owns `create-core.ts`, harness extension wiring, `AgentDoc.tools` offering): notes, wiring, e2e with the fake SDK (turn on Linear, a read-only call shows a card with a result, a write call asks, Allow once, Deny, Always allow).
3. **Verify for real**: on this machine, turn on Linear, ask a Claude CLI thread "list my Linear teams"; ask it to draft (not send) something that needs a write tool and deny it.

## Testing

- Core: the inbox (the CLI result and the next message both arrive before the next `streamSimple`; drained in order); connector results never sent as user text in Continue, Resume, Resume-at; toggling a connector does not change the hash and takes Resume; name mapping round-trip; observed result early (before the Pi `ToolCall`), during, and after the stream with no listener; result content unchanged; connector results not delivered to the CLI; connector ids not in `expected`; Continue after a connector-only message; Resume-at a checkpoint between a connector call and its result; mixed message; abort interrupts; rebind transcript renders observed calls; locked-down options when nothing is on; allowlist content and `canUseTool` denying non-chosen servers; wait-for-connectors with a fake clock and the 5 s cap; connector status errors pass `neutralText`.
- Approvals: pending → allow/deny/always; Stop denies; always-allow persists; goal/timer turns wait.
- Web: connector rows per state, switch, approval card actions, no "Claude Code" text.

## Risks

- Context and cost: each chosen server adds its schemas to every request; the Settings row shows the tool count.
- Late connectors: the 5 s wait slows the first message of a new query; Continue paths do not wait.
- Writes run in the user's org (Slack posts, Linear changes). Approval is on by default for every non-read-only tool; a missing `annotations.readOnly` counts as a write.
- The CLI's MCP behaviour can change on SDK bumps; pins (k)–(r) run on each bump.
