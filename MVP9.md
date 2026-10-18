# MVP9 plan: Claude CLI provider (personal use)

Status: APPROVED v3 (review rounds 1–3 applied). Builds on PLAN.md "Later → Claude CLI provider" and the spike `scratchpad/claude-sdk-spike/notes.md`. New evidence: `scratchpad/mvp9-explore/park.mjs` (3 Haiku turns, results below).

## Goal

> I use tau at work as I use the `claude` CLI: my CLI login works in tau with no key, and I get the same model choices. Usage counts against my own Claude plan.

## Scope

In:
1. **Detection**: the `claude-cli` provider row reads `claude auth status --json`. No login flow in tau.
2. **Models**: the same list as Claude Code's `/model` (Agent SDK `supportedModels()`), with effort levels.
3. **Threads on a Claude CLI model** run through the Agent SDK. Pi Durable keeps the loop, the tools and the transcript (architecture A).
4. **Plan usage**: the 5-hour utilization in the provider row detail.
5. **Conditions** (all must stay true):
   - tau never reads, copies or stores tokens, the Keychain or `~/.claude` credential files. Detection uses only `claude auth status --json` and `accountInfo()`.
   - Every SDK query sets `strictMcpConfig: true` and `settings: { disableClaudeAiConnectors: true }`.
   - The SDK version is pinned exactly (no `^`). tau runs the SDK's **bundled** CLI, never the installed one. Settings shows both versions.
   - The UI says "Claude CLI" or "Claude Agent SDK". It never says "Claude Code".
   - A one-time notice in Settings: "Runs the Claude Agent SDK under your own Claude login, for your own use." tau never offers this login to other users.
   - Kill switch: `TAU_DISABLE_CLAUDE_CLI=1` hides the provider and its models, and no SDK code loads.
   - The SDK child gets no `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`. tau stops the run when `init.apiKeySource !== "none"`.

Out (later plans): Claude Code features (hooks, plugins, skills, CLAUDE.md, built-in tools, its subagents, `/compact`, permission modes), claude.ai connectors, a login flow in tau, `claude setup-token`, the CLI on a remote runtime, the `max` effort, `opusplan` and `[1m]` aliases, session persistence across tau restarts, a query cap, the 7-day window and a header usage chip, offering this to other users.

## Design: how an Agent SDK thread fits into tau

### Evidence

- pi-ai accepts custom providers: `Provider` has `auth`, `getModels()`, `refreshModels()`, `stream()`, `streamSimple()` (`pi-ai/dist/models.d.ts:70-125`). `Api` is an open string (`types.d.ts:20`). `ApiKeyAuth` has `resolve()` and a side-effect-free `check()` (`auth/types.d.ts:170-196`). tau registers providers with `models.setProvider` (`core/src/provider/real-models.ts:22-31`).
- Pi Durable calls `models.streamSimple(model, { messages }, { signal, sessionId, reasoning })` once per model request (`pi-durable/dist/harness/generation.js:122-127,315`). It omits `reasoning` when the level is `off`. `sessionId` lives in doc `pi.provider`; **a fork gets a fresh one** (`harness/provider.js:3-12`). Rewind is a fork before the entry (`core/src/harness/conversation-fork.ts:16`).
- On abort, Pi appends the partial as an aborted assistant message and gives calls that never started `aborted` results (`generation.js:191-203,266`).
- The system prompt, its sections and the tool definitions come as system messages with `sections`, `toolsAdded`, `toolsRemoved` (`pi-ai/dist/types.d.ts:340-356`).
- Compaction calls `completeSimple` with `[system, user]` and no tools; Pi renders the summarized transcript itself (`harness/compaction.js:108-128`). Titles and the goal judge do the same (`core/src/titles/title-service.ts:48`, `core/src/goals/judge-model.ts:46`).
- Busy state, queue, steer, abort, run-end and the goal judge come from Pi runs (`core/src/harness/live-state.ts:9-18`, `conversation-start.ts:63-68`, `core/src/status/status-tracker.ts:28`). `Tx.appendEntry` can write entries with no run (`pi-durable/dist/types.d.ts:734`).
- Agent SDK 0.3.302 (`sdk.d.ts`): `createSdkMcpServer({ timeout, alwaysLoad })` (631-661); `systemPrompt` (2448); `resume`, `forkSession`, `resumeSessionAt` (1740, 2118-2132); `settings.autoCompactEnabled` (9403), `disableClaudeAiConnectors` (7087); one `assistant` message per content block (3660); queued user messages fold into a running turn (3676); error codes incl. `oauth_org_not_allowed`, `rate_limit` (3751); `SDKRateLimitInfo` (5769).
- `viewToText` renders tool calls but not tool results (`protocol/src/view-text.ts:22-31`), so the rebind seed needs its own renderer.

### Experiment (`mvp9-explore/park.mjs`, Haiku, 3 turns)

Options: `tools: []`, `strictMcpConfig: true`, `settingSources: []`, a custom `systemPrompt`, one in-process MCP server with **raw JSON Schemas** (low-level `tools/list` and `tools/call` handlers, no zod).
1. `init.tools` was only `mcp__tau__get_word`, `mcp__tau__get_number`; `mcp_servers` only `tau`; `apiKeySource: "none"`.
2. The handler gets `_meta["claudecode/toolUseId"]`. A handler can **park** (an open promise); resolved 3 s later, the model answered "banana 42".
3. Two parallel `tool_use` blocks: the CLI called the handlers **one after the other**. `message_delta stop_reason: "tool_use"` came before any result.
4. `abortController.abort()` with a parked handler: the CLI wrote "The tool call was interrupted…" and the model **retried twice** before the process ended.
5. `query({ resume })` after that crash worked; the tool result sent as user text gave the right answer.
6. Usage is on each `assistant` message; `modelUsage.contextWindow` was 1,000,000; `costBasis: "list"` (not a charge).

### Options

| | A: pi-ai provider drives the SDK | B: "Claude thread" kind, SDK owns the loop | C: interactive `claude` in a PTY |
|---|---|---|---|
| Loop, transcript, durability | Pi Durable, unchanged | SDK; tau mirrors with `appendEntry` | CLI; tau reads `~/.claude/projects` |
| Tools | Pi tools as in-process MCP tools; built-ins off | Claude Code built-ins | Built-ins |
| Streaming, usage, meter | Mapped to pi-ai events and `Usage` | New mapping; partials need `pi.live` writes | File polling, no deltas |
| Abort, steer, queue | Pi; adapter calls `interrupt()` | Rebuilt outside Pi | Keystrokes |
| Forks, goals, timers, monitors, subagents, worktrees | Work (Pi or tau features); forks rebind | Break or need a second path | Lost |
| Lost | Exact CLI behaviour; cache on rebind | Pi tools, runtimes later | Almost all of tau |
| Effort, risk | Medium; parked calls, session drift | High; two sources of truth | High; brittle |

### Decision: A

A Claude CLI model is one more pi-ai provider. Its `streamSimple` drives one SDK query per Pi `sessionId`. Pi Durable keeps every feature. Evidence: the provider API exists, the parked MCP round-trip works, resume recovers a lost process.

### The adapter (`core/src/claude-cli/stream/`)

- **Binding** (in memory only): `piSessionId → { sdkSessionId, query, input, calls, checkpoints, model }`. `calls` is a `toolUseId → deferred` map. `checkpoints` is a list of `{ hash, sdkUuid }`, one after each finished Pi stream.
- **Deferred map**: get-or-create on both sides. The MCP handler takes (or creates) the deferred for its `toolUseId` and awaits it. A new `streamSimple` call resolves (or creates, already resolved) the deferred for each tool result. So the order of handler calls and results does not matter (experiment 3).
- **The hash** covers a normalized message list: system, user, assistant and tool-result messages by role, text, tool call ids, names and arguments. It **leaves out** assistant messages with `stopReason` `aborted` or `error`, and tool results with an `aborted` error. The SDK session has its own record of those.
- **Paths** for each call:
  1. **One-shot** (no tool declared: compaction, titles, judge): a fresh query, `persistSession: false`, `maxTurns: 1`, `tools: []`, messages as text.
  2. **Continue**: the normalized messages start with the last checkpoint and the query is live. Deliver the new messages (see order below).
  3. **Resume**: the same match, but the query was closed (idle). `query({ resume: sdkSessionId })`; tool results go in as one user text.
  4. **Resume-at**: the messages match an earlier checkpoint **of this binding**. Interrupt and close the live query (it can hold the failed assistant message and its error). Then `resume: sdkSessionId` + `resumeSessionAt: sdkUuid` + `forkSession: true`, and deliver. The fork has a new session id: it replaces `sdkSessionId`. tau abandons the old session and deletes it with the SDK's `deleteSession()` (`sdk.d.ts:674-688`), only for sessions tau created, and only after the new query has started, so a failed fork never loses the only session. If pin (h) fails, this path becomes Rebind.
  5. **Rebind**: no matching checkpoint (checkpoints live in memory: they survive an idle close but not a tau restart, so after a restart only an exact match of the stored last state can Resume, else Rebind). A new SDK session; tau deletes the old one as in 4. The first user message is the transcript rendered by `rebind-transcript.ts` (user, assistant and tool calls, **tool results** cut to 4,000 characters each, with the marker `[truncated N characters]`), then the new messages.
- **Delivery order** in Continue: (1) resolve the deferreds with the tool results, in transcript order; (2) push the user messages (steers) into the streaming input. Pi places steers only at round boundaries, so they arrive with the results; the CLI folds them into the same turn (pin i). A user message after `end_turn` (no tool results) starts a new CLI turn. If pin (i) fails, a steer goes as `<user-message>` text at the end of the last tool result.
- **Tool results to MCP**: `content` = Pi text blocks as `{ type: "text" }` and images as `{ type: "image", data, mimeType }`; `isError` from the Pi result. A result for a call whose handler already settled (after an interrupt) goes in as user text.

| Pi operation | Path |
|---|---|
| New message, follow-up, notification, timer, goal continuation | Continue |
| Tool round, with or without steers | Continue |
| Stop, then a new message (interrupted, not closed; aborted parts not in hash) | Continue |
| Retry after an error (needs pin h) | Resume-at the checkpoint before the failed request; no such checkpoint in memory → Rebind |
| Thread idle more than 15 min, then a message | Resume (exact match of the last checkpoint, kept on close), else Rebind |
| tau restart | Rebind (no persistence in the first cut) |
| Fork, rewind, checkpoint rewind (fork before an entry) | Rebind (new Pi `sessionId`) |
| Pi compaction | Rebind |
| Switch to Claude CLI from another provider | Rebind |
| Model change inside Claude CLI | Continue, after `q.setModel(value)` |
| Effort change | Continue with `applyFlagSettings` (pin j), else Resume with the new `effort` |
| A system message: new prompt or changed section | Rebind |
| Tools added or removed | Continue with `tools/list_changed` if pin (g) passes; **else Rebind (the default)** |

- **System prompt**: `systemPrompt` is Pi's prompt string. It replaces the CLI preset on purpose: tau's tools and instructions, not Claude Code's. A running SDK session cannot get a new system prompt, so a changed prompt or section forces a Rebind.
- **One Pi stream = one API message**. It ends at `message_delta` with `stop_reason: "tool_use"` (Pi `toolUse`; all `ToolCall`s, ids `toolu_…`) or `end_turn` (Pi `stop`).
- **Tools**: one SDK MCP server `tau` per binding, from `toolsAdded`/`toolsRemoved`, JSON Schemas as is, `alwaysLoad: true`, `timeout` 24 h. Names `mcp__tau__<name>` ↔ `<name>`.
- **Query options, always**: `tools: []`, `strictMcpConfig: true`, `settingSources: []`, `settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false }`, `permissionMode: "dontAsk"`, `allowedTools: [mcp__tau__*]`, `systemPrompt`, `includePartialMessages: true`, `cwd` = thread workspace, `env` = process env minus `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`, `title: "tau · <thread title>"`.
- **Events**: `text_delta`, `thinking_delta`, `input_json_delta` → pi-ai `text_*`, `thinking_*`, `toolcall_*`; `responseModel` = `message.model`.
- **Usage**: from the API message's final usage. `cost` = 0 (plan usage is not money).
- **Effort**: `reasoning` `undefined` = thinking off (where `supportsThinkingOff`; else the lowest level). `minimal` → `low`; `low|medium|high|xhigh` as is. A change applies at the next request. The thinking change itself misses the API prompt cache, so waiting for a rebind would not save the cache.
- **Abort**: Pi `signal` → `q.interrupt()`, then reject the open deferreds. Never `abortController.abort()` (experiment 4). The stream ends with `{ type: "error", reason: "aborted" }` and the partial content kept, `stopReason: "aborted"`.
- **Closing**: a query closes when its thread is idle for 15 min (the next call resumes), and at once on archive or delete. A thread with a parked handler (a long Pi tool) counts as busy and never closes for idle. tau shutdown closes all.
- **Process count**: no hard cap. When more than 6 SDK processes are alive, the Claude CLI status note shows a soft warning ("8 Claude processes running").
- **Errors** → `stopReason: "error"` with a clear text:
  - `rate_limit` or `rejected`: "Plan limit reached; resets 15:00". With deferreds open, tau interrupts the query and rejects them; Pi's goal logic pauses (MVP8 §7).
  - `oauth_org_not_allowed`, `authentication_failed`, `account_on_hold`, `billing_error`: no retry; the provider state changes (see Web).
  - `overloaded`, `server_error`: Pi's retry (Resume-at).
- **Rate limits**: each `rate_limit_event` updates an in-memory `PlanUsage` and emits `changes.emit({ resource: "providers" })`.

### Feature map for a Claude CLI thread

Unchanged: streaming, tool cards, the context meter, abort, steer, queue, compaction (Pi's), subagents (each child has its own binding, or another provider), goals, timers, monitors, worktrees. Changed: retry uses Resume-at; forks, rewinds and checkpoint rewinds work but rebind (prompt cache lost, tool results cut); a tau restart rebinds. Checkpoints still record files, because Pi tools do the writes.

## Protocol

- `ProviderIdSchema` += `"claude-cli"`. `ProviderMethodSchema` += `"claude_cli"`. `ProviderConnection.source` += `"cli"`.
- `ProviderInfo.cli: ClaudeCliStatus | null`:
  - `state: "ready" | "needs_notice" | "missing" | "logged_out" | "not_plan" | "blocked" | "error"`;
  - `plan`, `org`, `cliVersion` (installed), `sdkCliVersion` (bundled), `message`: `string | null`;
  - `usage: { status: "allowed" | "allowed_warning" | "rejected", fiveHour: number | null, resetsAt: number | null, updatedAt } | null`.
  - No email, no ids, no tokens.
- `Settings.claudeCliNoticeAt: number | null`.
- `Core.providers.acknowledgeClaudeCli()` → `POST /providers/claude-cli/notice`; `Core.providers.refreshClaudeCli()` → `POST /providers/claude-cli/refresh`. CLI command table: `providers claude-cli refresh`.
- `ModelInfo` unchanged. Rows: `provider: "claude-cli"`, `modelId` = SDK `value` (`opus`, `sonnet`, `haiku`, `fable`, `default`, `claude-opus-4-7`…), `name` = `displayName`, `providerName: "Claude CLI"`.

## Core

- `core/src/claude-cli/sdk-port.ts`: the only file that imports the SDK, with a dynamic `import()`. Interface `ClaudeSdkPort { authStatus(), accountInfo(), supportedModels(), startQuery(options) }`.
- **Detection** (`detect/`): `claude auth status --json` (path from `TAU_CLAUDE_PATH` or `PATH`), 5 s timeout. Read only `loggedIn`, `authMethod`, `subscriptionType`, `orgName`; `claude --version` for `cliVersion`. ENOENT → `missing`; `loggedIn: false` → `logged_out`; `authMethod !== "claude.ai"` → `not_plan`; no notice → `needs_notice`; else `ready`.
  - Refresh: on Settings open, "Check again", the notice, an auth error, and every 60 s in the background.
  - A timeout or a parse failure keeps the last state (stale while it checks again) and sets `message`. Only a definite answer changes the state, so models do not flicker.
- **Models** (`models/`): `refreshModels()` calls `supportedModels()` (no model call) when the state becomes `ready` and on refresh, and keeps the list in memory. `getModels()` returns that list (empty before the first refresh, empty when not `ready`); it never blocks or throws. Context window: the last `modelUsage.contextWindow` the SDK reported for the model, else pi-ai's `anthropic` catalog for `resolvedModel`, else 200,000. Images and reasoning from the catalog.
- **Provider** (`provider.ts`): `auth.apiKey.check()` and `resolve()` are async and read only the cached state (no process start); configured only when `ready`. `streamSimple` → the adapter.
- `providers-table.ts` gets an entry kind `"cli"` (no key URL, no validator). `setApiKey`/`disconnect` refuse it with `AppError("invalid_input")`.
- Pin `"@anthropic-ai/claude-agent-sdk": "0.3.302"`. A test fails when the bundled `claudeCodeVersion` changes.

## Web

The Providers rebuild is already on main (`a579ae0`): `components/ui/provider-list.tsx` (`ProviderList`, `ProviderListRow`, `ProviderListName`, `ProviderListStatus` with a `note` prop, `ProviderListActions`, `ProviderListDetail`) and `settings/ProviderRow.tsx`. The name column has no description; the description is the `note` under the status badge. The Claude CLI row uses the `note` for its detail:

| State | Status badge (tooltip = full text) | Note under the badge | Primary action | `ProviderListDetail` |
|---|---|---|---|---|
| ready | "Connected via claude CLI · Team · Maze" | "5-hour 43% · resets 15:00 · CLI 2.1.302" | Check again | — |
| needs_notice | "Detected · Team · Maze" | "Claude Agent SDK, under your own login." | I understand | The notice text (Scope 5) |
| missing | "claude CLI not found" | "Install the claude CLI and log in." | Check again | — |
| logged_out | "Not logged in" | "Run `claude`, then `/login`, on this machine." | Check again | — |
| not_plan | "API key login" | "The CLI uses an API key. Use the Anthropic provider." | Check again | — |
| blocked | "Blocked by your organization" (destructive) | `message` | Check again | — |
| error | "Check failed" | `message` | Check again | — |

- Usage `allowed_warning` → the note is amber; `rejected` → "Plan limit reached · resets 15:00".
- The note adds "tau uses 2.1.302" when the installed CLI version differs, and the process warning when more than 6 run.
- **Model picker**: group "Claude CLI"; rows "Opus 5.5 (opus)", "Sonnet 5.5 (sonnet)", "Haiku 5.5 (haiku)", "Fable 5.1 (fable)", then pinned ids. Search matches the alias and `provider/modelId`.
- **Thread header**: the picker shows "Claude CLI · Opus 5.5"; effort levels from the row. No new chip.

## Phases and owners

0. **Foundation** (one agent): protocol schemas and routes; server routes; testkit fake core and contract tag `claude-cli` (pending cases); web query hooks; `sdk-port.ts` and the scripted fake SDK; `providers-table.ts`; `real-models.ts` with the `claude-cli` provider wired in (it imports `core/src/claude-cli/provider.ts`); a stub file for every owner below.
   - The fake SDK models: handlers called one after the other; `interrupt()` ends the turn with interrupted results; folding of queued user messages; `rate_limit_event`; error codes.
   - Packaging decision: measure the `tau` install size with the 268 MB platform binary. Decide: an optional dependency installed on first use ("Install Claude Agent SDK" action), or bundled. Write the decision in this doc.
   - Real-CLI pins (`TAU_REAL_CLAUDE=1`, at most 6 Haiku turns), **required before merge**: (a) init tools only `mcp__tau__*`, servers only `tau`, `apiKeySource: "none"`; (b) parked handler round-trip; (c) results delivered in reverse order and before the second handler parks; (d) `interrupt()` with a parked handler gives no retry loop; (e) resume after a killed process; (f) `autoCompactEnabled: false` honoured; (g) `tools/list_changed` mid-session; (h) `resumeSessionAt` + `forkSession`; (i) a steer pushed with tool results folds into the same turn; (j) `applyFlagSettings` changes effort live.
   Done when check, test and build pass.
1. **Parallel** (no overlaps):
   - **A: Detection, models, status** owns `core/src/claude-cli/{detect,models}/**`, `core/src/claude-cli/plan-usage.ts`, `core/src/provider/{connections,model-list,provider-service}.ts`.
   - **B: Adapter** owns `core/src/claude-cli/stream/**`, `core/src/claude-cli/provider.ts`.
   - **C: Web** (starts on the current main, with the provider list and `note` already merged) owns `web/src/settings/{ProviderRow.tsx,provider-status.ts,ClaudeCli*}`, `web/src/setup/ModelCombobox.tsx`.
   Nobody edits files they do not own. Needed changes go in a note for the integrator.
2. **Integration** (one agent): applies the notes, merges each branch, runs check and test after each merge, then e2e.
3. **Verify for real**: the user runs it on the work machine: the row shows "Connected via claude CLI · Team · <org>"; a Haiku thread reads a file with a Pi tool; Stop mid-tool, then a new message; a fork continues; the usage percentage moves.

## Testing

- Detection: fixture scripts for `TAU_CLAUDE_PATH` print each `auth status` shape (logged in, logged out with exit 1, `authMethod: "console"`, malformed JSON, a 10 s sleep). Missing binary. A timeout keeps the last state. The stored status never has `email` or `orgId`.
- Models: the fake returns the spike's 14 rows; aliases, effort levels, context windows; no models before the notice; `getModels()` never throws.
- Adapter, with the fake SDK:
  - deltas; one Pi stream per API message; `toolUse` with two calls;
  - the deferred map: results early, late and in reverse order;
  - Resume-at with and without a checkpoint; abandoned sessions deleted; the truncation marker;
  - delivery order: results, then steers; a message after `end_turn`;
  - abort: `interrupt()`, rejected deferreds, the final `aborted` event with the partial;
  - every row of the Pi operation table picks its path;
  - one-shot calls; the rebind transcript keeps tool results;
  - MCP result shape (text, image, `isError`);
  - usage, zero cost; `apiKeySource` other than `"none"` stops the run;
  - every recorded query has `strictMcpConfig`, `disableClaudeAiConnectors`, `tools: []` and no API key in `env`;
  - error mapping, plan limit with open deferreds; closing on idle (fake clock), archive and delete.
- Kill switch: with `TAU_DISABLE_CLAUDE_CLI=1`, no row, no models, no SDK import.
- Contract tag `claude-cli` (fake core): states, notice, refresh, model listing.
- Web: each row state, the notice, the detail line, the picker group. A test checks that no rendered text, including error texts from the CLI (`oauth_org_not_allowed` and others), says "Claude Code".
- e2e (fake SDK, `TAU_FAKE_CLAUDE_CLI=1`): accept the notice, pick "Claude CLI · Haiku", a tool card appears, Stop, a new message, fork.

## Risks

- Parked handlers are new ground: CLI changes to MCP call order, timeouts or abort break the adapter. Pins (b)–(j) run on each SDK bump.
- Session drift: Resume-at and Rebind can give the model a slightly different history than Pi shows. A rebind loses the prompt cache and cuts tool results.
- Policy: Anthropic may move third-party use to usage credits or change the rules. tau stays personal, never touches tokens, shows the notice, and has the kill switch.
- Each live query is one CLI process. Many Claude CLI subagents cost memory (no cap in the first cut).
- SDK sessions show in the user's `claude --resume` list (title "tau · …"). tau deletes the sessions it abandons (Resume-at, Rebind, thread delete) with `deleteSession()`; a crash can leave a few behind.
