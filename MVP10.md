# MVP10 plan: Claude connectors in Claude CLI threads

Status: DRAFT v1. Builds on MVP9 (Claude CLI provider, architecture A) and the spike `scratchpad/connectors-spike/notes.md` (CLI 2.1.302, SDK 0.3.302, 5 Haiku turns, read-only).

## Goal

> In a Claude CLI thread, the agent can use the MCP servers my `claude` login has: my org's claude.ai connectors (Linear, Slack…) and my own `claude mcp` servers. I pick which ones in Settings. Tools that write ask me first.

## Scope

In:
1. **Connector list** in Settings → Tools, section "Claude connectors": every server from `mcpServerStatus()` with its state (connected, needs auth, failed, disabled) and tool count. A switch per server. Default: off.
2. **Connector tools in Claude CLI threads**: the CLI runs them; tau shows each call as a normal tool card with its result.
3. **Approval** for tools that are not read-only: an inline card in the thread with "Allow once", "Always allow this tool", "Deny". Read-only tools (MCP `readOnlyHint`) run with no prompt.
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
- One or more on: `strictMcpConfig: false`, `disableClaudeAiConnectors: false`, `allowedTools: [mcp__tau__*, …chosen read-only tool names]`, `canUseTool` callback for the chosen servers' other tools (pin n), `dontAsk` otherwise unchanged. Chosen servers not in the list are switched off with `toggleMcpServer(name, false)` right after init (pin o), so their schemas do not fill the context.
- **Wait for connectors**: before the first input of a new query, poll `mcpServerStatus()` every 250 ms until no chosen server is `pending`, cap 5 s. On timeout the turn goes on; the status note says which servers were late.

### Observed tool calls (the core change)

A connector `tool_use` is a call that Pi must show but not run.
- **Names**: Pi sees `connector__<server>__<tool>` (normalized, ≤ 64 chars); the adapter maps it to `mcp__claude_ai_<Server>__<tool>` and back.
- **Passthrough tool**: the harness registers one Pi tool per chosen connector tool, from the cached `mcpServerStatus()` schemas, in a new `core/src/claude-cli/connectors/` module. Its `execute()` awaits an **observed result** deferred keyed by `toolUseId` (the same get-or-create deferred map as MVP9) and returns the CLI's result content and `isError`. These tools are only active in Claude CLI threads (pin p: Pi Durable can add/remove tools per conversation).
- **Adapter**: ends the Pi stream at `tool_use` as today, with all calls (tau and connector) as `ToolCall`s. The pump keeps reading: a CLI `user` `tool_result` for a connector id resolves its observed deferred. On the next `streamSimple`, tool results for connector ids are **not** delivered to the CLI (it already has them); they still count in the hash.
- **Tool definitions to the CLI**: the adapter filters `connector__*` tools out of the `tau` MCP server, so the CLI never sees them twice.
- **Mixed message**: tau results go to MCP deferreds (MVP9), connector results come from the CLI. Order does not matter (deferred map).
- **Abort**: Pi aborting a passthrough tool → `q.interrupt()`; the observed deferred rejects with `aborted`.
- **Rebind / Resume-at**: the rebind transcript renders connector calls and results as text (the new session never ran them). Resume-at to a checkpoint before a connector call is fine (the SDK history has it).

### Approval

- `canUseTool(toolName, input, { signal, toolUseID })` (pin n) for non-read-only connector tools. tau appends an `app.tool-approval` entry `{ toolUseId, server, tool, input, status: "pending" }` to the thread and emits a change.
- The thread shows an approval card under the tool card: tool name, arguments (collapsed JSON), "Allow once", "Always allow this tool", "Deny". REST: `POST /conversations/:id/approvals/:toolUseId` `{ decision: "allow" | "allow_always" | "deny" }`. CLI command table: `threads approve <id> <toolUseId> --allow|--always|--deny`.
- "Always allow" stores the tool name in `Settings.claudeConnectors.alwaysAllow`. Deny returns `{ behavior: "deny", message: "The user denied this tool call." }`.
- While an approval is pending, the thread is busy (live work); Stop denies it and interrupts. A goal or timer turn that hits an approval waits like a user would (no auto-allow).

### Settings and status

- `Settings.claudeConnectors: { enabled: string[]; alwaysAllow: string[] }`.
- `ClaudeCliStatus.connectors: { name, source: "claudeai" | "user", status, toolCount, readOnlyCount }[] | null`, from a cached `mcpServerStatus()` probe (one short-lived query with `maxTurns: 0` or no input, pin q), refreshed on Settings open and "Check again". No tool schemas over the wire.
- Settings → Tools → "Claude connectors" (only when the Claude CLI row is `ready`): one row per server: name, status badge for non-connected states, "N tools · M read-only", switch. "needs auth" rows say "Connect it on claude.ai" and have no switch.

## Pins (real CLI, `TAU_REAL_CLAUDE=1`, read-only calls, ≤ 8 Haiku turns, required before merge)

- (k) A connector call and a parked tau handler in one message: does the connector run while ours is parked, and does a late tau result still give a correct turn?
- (l) `allowedTools` with `mcp__claude_ai_Linear__*` glob works.
- (m) Loading user-scope `claude mcp` servers: which option does it (`settingSources: ["user"]`, `mcpServers` passthrough) and what else it loads (hooks, CLAUDE.md, permissions). If it brings hooks or CLAUDE.md, user servers are Out.
- (n) `canUseTool` is called for connector tools not in `allowedTools` under the permission mode we use, and `deny` / `allow` work; a long wait (5 min) for the user does not time out.
- (o) `toggleMcpServer(name, false)` removes that server's tools from the next request.
- (p) Pi Durable: adding/removing tools per conversation mid-thread (passthrough set changes when the user toggles a server).
- (q) A status probe query that never calls the model (no API usage) and returns `mcpServerStatus()`; time to all non-pending.
- (r) `readOnlyHint` is present in `mcpServerStatus().tools[]` annotations for Linear and Slack.

## Phases and owners

0. **Foundation** (one agent): pins (k)–(r) with results in this doc; protocol (`Settings.claudeConnectors`, `ClaudeCliStatus.connectors`, approval entry and route, CLI command); server route; testkit fake core + contract tag `claude-connectors` (pending); fake SDK: connectors in `mcpServerStatus`, CLI-executed tool results, `canUseTool`; stubs for every owner.
1. **Parallel**:
   - **A: Connectors core** owns `core/src/claude-cli/connectors/**` (probe, cache, passthrough tools, name mapping, settings), `core/src/provider/provider-service.ts` connector status.
   - **B: Adapter** owns `core/src/claude-cli/stream/**` (query options, wait for connectors, observed results, skip delivery, filter, abort, rebind text, `canUseTool` bridge to an approval port).
   - **C: Approvals core** owns `core/src/approvals/**` (entry, pending map, decide, always-allow, Stop denies, live-work).
   - **D: Web** owns `web/src/settings/ClaudeConnectors*`, `web/src/conversation/ToolApproval*`, tool card label for connector tools.
2. **Integration**: notes, wiring in `create-core.ts` and the harness, e2e with the fake SDK (turn on Linear, a read-only call shows a card with a result, a write call asks, Allow once, Deny, Always allow).
3. **Verify for real**: on this machine, turn on Linear, ask a Claude CLI thread "list my Linear teams"; ask it to draft (not send) something that needs a write tool and deny it.

## Testing

- Core: name mapping round-trip; passthrough resolves from the CLI result, early and late; connector results not delivered to the CLI; mixed message; abort interrupts; rebind transcript renders observed calls; locked-down options when nothing is on; allowlist content; wait-for-connectors with a fake clock and the 5 s cap.
- Approvals: pending → allow/deny/always; Stop denies; always-allow persists; goal/timer turns wait.
- Web: connector rows per state, switch, approval card actions, no "Claude Code" text.

## Risks

- Context and cost: each chosen server adds its schemas to every request; the Settings row shows the tool count.
- Late connectors: the 5 s wait slows the first message of a new query; Continue paths do not wait.
- Writes run in the user's org (Slack posts, Linear changes). Approval is on by default for every non-read-only tool; a missing `readOnlyHint` counts as a write.
- The CLI's MCP behaviour can change on SDK bumps; pins (k)–(r) run on each bump.
