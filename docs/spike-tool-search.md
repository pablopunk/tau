# Spike: tool search for tau's Claude CLI threads

**Verdict: works with a one-line change.** `tools: []` (`stream/query-options.ts:79`) disables `ToolSearch`, so MCP schemas load in full. Use `tools: ["ToolSearch"]` and they are deferred.

Measured for real (SDK 0.3.302 / CLI 2.1.302, the user's claude.ai account: 51 servers, 14 connected, ~600 MCP tools). Scripts: `packages/core/spike/*.mjs` (removed from the tree; see commit 7c230f1).
Query options are tau's connector options (`strictMcpConfig:false`, `disableClaudeAiConnectors:false`, `settingSources:[]`) with the variant below; numbers from `getContextUsage()`.

## 1. Deferral per variant
| variant | total context tokens | MCP tokens in window | MCP tokens deferred |
|---|---|---|---|
| (a) `tools: []` (today) | **646,364** | 640,889 | 0 |
| (b) `tools: ["ToolSearch"]` | **6,914** | 608 | 640,286 |
| (c) `tools: []` + `allowedTools: ["ToolSearch"]` | 646,364 | 640,889 | 0 (does not help) |
| (d) `tools: []` + `ENABLE_TOOL_SEARCH=auto:1` | 646,364 | 640,889 | 0 (does not help) |
| (e) `tools: ["ToolSearch"]` + `auto:1` | 6,914 | 608 | 640,286 |
| (f) `tools: ["ToolSearch"]` + `ENABLE_TOOL_SEARCH=false` | 646,364 | 640,889 | 0 (switch really is off) |

Caveats: with `tools: []` the 640k does not fit any window, so enabling all connectors today is unusable. Also, in (a) `getContextUsage().mcpTools[].isLoaded` is `false` for most tools even though they are in the window (category "MCP tools=640,889"). tau's `toContextSummary` (`sdk-port.ts:43`) therefore under-reports loaded tools. Read `categories` ("MCP tools" vs "MCP tools (deferred)") instead.
Remaining cost with deferral: ~5.5k tokens of "MCP server instructions" (per-server instructions are not deferred) plus ~0.8k for ToolSearch.

## 2. Env
No `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, `ANTHROPIC_BASE_URL` or `ENABLE_TOOL_SEARCH` anywhere in `packages/core` or the spawn path. `withoutApiKeys` (`sdk-port.ts:84`, `query-options.ts:13`) only strips `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`. The env is `process.env` minus those, so a user who exports those variables would silently lose deferral. Detect it in the probe via `categories`.

## 3. Calls to discovered tools
Real run (`tool-search-call-spike.mjs`; sonnet, `tools:["ToolSearch"]`, exact-name `allowedTools`, `canUseTool` that denies everything): the model called `ToolSearch select:mcp__claude_ai_Context7__resolve-library-id`, got a `tool_reference`, then called `mcp__claude_ai_Context7__resolve-library-id` and got the real result. The final tool name is the normal `mcp__claude_ai_<Server>__<tool>`, so `parseConnectorToolName` / `isConnectorToolName` (`connectors/names.ts`) and the `claude_connector` adapter see no difference. Both calls still go through `allowedTools` (exact names auto-allow and skip `canUseTool`, as the SDK warns) or, for other tools, `createCanUseTool` (`stream/permissions.ts`), which receives `mcpServer`. `ToolSearch` itself was not gated by `canUseTool` (read-only built-in), so tau's stream layer must render or hide a `ToolSearch` tool_use/tool_result; there is no handling of it today (`grep ToolSearch` finds nothing).
`disallowedToolsOf` globs do work with deferral: disallowing DataDog and Incident.io cut the deferred list from 601 tools / 640k tokens to 339 / 407k, so disallowed tools are not counted or listed. Exact-name `allowedTools` for deferred tools is fine (they are only permissions). With all connectors on, `chooseServers` would list every tool name of every connected server in `allowedTools`: large but not in the model context.
Not tested: calling a write tool through the approval card (`askBeforeWrites`) after discovery. The code path is identical by name, so it is expected to work. Also not tested: a user-defined (non claude.ai) server.

## 4. Side effects
- Extra round trip: one `ToolSearch` turn per new tool (the sonnet run used 2 tool calls instead of 1). `maxTurns` budgets and tau's tool-card UI see one more call.
- Haiku: a first run with `model: "haiku"` found no tools (it never got `ToolSearch`/tools because servers had not connected yet; the retry used sonnet and waited for connection). Tool search needs a model that supports `tool_reference`; verify haiku separately before enabling for all models.
- Timing: MCP connects asynchronously. A prompt sent before servers settle sees no connector tools at all (reproduced: "no tools available"). tau's probe already waits for status; the real query must too, or turn 1 misses tools.
- `alwaysLoad: true` is not needed and should be avoided: it blocks startup up to 5s per server and defeats the purpose.
- Compaction: tau sets `autoCompactEnabled:false`, so no compaction there. Per the docs, discovered tools are tracked per session and stay loaded; if manual `/compact` is ever enabled, re-verify that discovered tools survive. Not tested here.

## Recommended minimal change
1. `buildQueryOptions` (`query-options.ts:79`): `tools: input.connectors ? ["ToolSearch"] : []`. Keep `[]` for locked-down threads so no built-in is exposed. Also change `probeOptions` (`sdk-port.ts:144`) to the same so `contextSummary()` measures what threads get.
2. Fix `toContextSummary` to use `categories` ("MCP tools (deferred)") rather than `isLoaded`.
3. Render/hide `ToolSearch` calls in the stream mapper.

## Follow-up for "all connectors on by default"
- Default `enabled` = all connected claude.ai servers; keep `disallowedToolsOf` for opted-out ones; keep `askBeforeWrites` default on.
- Add a real-CLI pin (in `pins/`) asserting total context < ~20k with all connectors on and a discovered call going through `canUseTool`; fail loudly if `categories` shows no "(deferred)" row (catches `ENABLE_TOOL_SEARCH=false`, disabled betas, or a custom `ANTHROPIC_BASE_URL`).
- Await connector settle before the first turn; test haiku and the model list.
- The `claude_connector` offering text (`harness/connector-offering.ts`) should list server names only, since the tool names come from `ToolSearch`.

## Implementation status
Done (all connectors on by default, with tool search):
- **Tool search.** `buildQueryOptions` uses `tools: ["ToolSearch"]` only when connectors are chosen (`tools: []` otherwise); `ToolSearch` is in `allowedTools`. `probeOptions` uses `["ToolSearch"]` too.
- **Stream.** A `ToolSearch` call becomes an observed `claude_connector` step (`server: "Tool search"`), so `connectorIds`/`observed`/"Continue." bookkeeping is unchanged. The web shows it as a small "Looked up connector tools" card (`connectors/names.ts`: `observedCallOf`, `isObservedToolName`).
- **Context summary.** `toContextSummary` reads the `kind: 'deferred'` "MCP tools (deferred)" row (new fields `mcpTokens`, `deferredMcpTokens`, `totalTokens`); `loadedMcpToolCounts` trusts `isLoaded` only when something is deferred.
- **Opt-out settings.** `ClaudeConnectorSettings.enabled` became `disabled`. Every connected claude.ai/user server is chosen unless disabled; `needs_auth`/failed/pending are still excluded. The settings store drops a legacy `enabled` list on read, so existing installs start with everything on. `askBeforeWrites` is untouched (default off). Protocol hash bumped.
- **Turn 1.** The existing settle wait (`wait-connectors.ts`, 10 s cap, "late" note) now covers every chosen connector. No `alwaysLoad`.
- **Real-CLI pin** `t` (`pins/scenario-tool-search-budget.ts`, `TAU_REAL_CLAUDE=1 TAU_PINS_ONLY=t`): model-free probe, fails if the deferred row is missing or MCP tokens in the window reach 15k. Measured here: 14 connectors, 610 tools: 608 MCP tokens in the window, 640,286 deferred, 6,914 total.
- **Haiku: verified.** Real CLI, `tools: ["ToolSearch"]`, `ToolSearch select:` then the real `mcp__claude_ai_Context7__resolve-library-id` call succeeded for both the `haiku` alias and `claude-haiku-4-5-20251001` (the earlier "no tools" was the connect race). Only legacy Claude 3 model ids get no connectors (`connectors/tool-search.ts`), rather than loading every schema.

Not verified: a write tool through the approval card after discovery (same tool name path, covered only by the fake CLI); a user-defined (non claude.ai) server through tool search; a user who exports `ENABLE_TOOL_SEARCH=false` / a custom `ANTHROPIC_BASE_URL` (the pin catches it, threads do not detect it at runtime and would load all schemas); a mid-thread switch from a legacy model to a current one keeps the old query's options until it restarts.
Follow-up: the ~5.5k tokens of per-server MCP instructions are not deferred.

### Write and user-server verification (real CLI)
Pins `w1` to `w5` (`pins/real-tool-search-pins.test.ts`, `TAU_REAL_CLAUDE=1`, fixture `pins/fixtures/tool-search-fixture-server.mjs`: a local stdio server with `fixture_read` (readOnlyHint true) and `fixture_write` (appends to a temp file)). Options come from tau's `buildQueryOptions`, `chooseServers` and `createCanUseTool`; only the approvals port is a fake. The server is named `claude.ai Fixture` so tau's connector names apply. Observed on CLI 2.1.302, haiku, 5 turns:
- Both tools were found with `ToolSearch` first, then called; the CLI status reports `fixture_read:true, fixture_write:false`.
- `askBeforeWrites` on: the read ran with no `canUseTool` and no approval; the write reached `canUseTool` (`mcp__claude_ai_Fixture__fixture_write`) and the approvals port (`Fixture/fixture_write`) before running; deny left the file empty; allow wrote `tau-pin-write`.
- `askBeforeWrites` off: the write ran with no prompt.
- A server named like a user server (`tau_fixture_user`): ToolSearch found it and the read ran (the CLI side works).
Still not verified: a real claude.ai write tool (none was safe to run: nothing is both private and reversible); a user-defined server inside a real tau thread. Tau threads use `settingSources: []`, so user-scope servers are not loaded, and the stream layer (`observedCallOf`, `createCanUseTool`) only maps `mcp__claude_ai_*` names, so such a server would need both changed. `ClaudeQueryOptions.mcpServers` was added for the pins only.
