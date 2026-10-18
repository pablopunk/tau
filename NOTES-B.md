# Notes from owner B (adapter) for the integrator

* `ClaudeQueryOptions` (`claude-cli/sdk-types.ts`) has no `disallowedTools`. `stream/query-options.ts` returns `StreamQueryOptions` (the frozen type plus `disallowedTools`); `sdk-port.ts` spreads options as is, so it reaches the SDK. Add the field to `sdk-types.ts` and drop the intersection type.
* New optional `ClaudeCliStreamDeps` (wire them in `create-core.ts` / provider service):
  * `observed`: the `ObservedResultStore` (`ClaudeConnectorToolServices.observed`). The pump calls `settle(toolUseId, result)` for every CLI connector `tool_result`.
  * `connectorStatus`: the cached probe list (A). Absent: the adapter probes by itself (`startProbe`, 60 s cache). The adapter needs tool names and `readOnly` flags before a query starts, so `allowedTools` can hold exact names.
  * `onConnectorsLate(notes)`: chosen servers still not connected after the 10 s wait; A puts them in the status note.
  * `connectorSettings` and `approvals` already existed. `approvals.isAlwaysAllowed` is called for every ask; `approvals.request` gets `piSessionId` = the Pi session id.
* The adapter does its own server choice (`stream/connector-choice.ts`): enabled and connected servers; read-only tools exact; always-allowed tools of chosen servers; `mcp__claude_ai_<Server>__*` disallowed for every other claude.ai server. It does not call A's `chooseServers` stub. Replace it with A's function if you want one source.
* No "options stale" hook is needed: each `streamSimple` reads `connectorSettings()` and closes an idle query whose choice differs.
* `claude_connector` is filtered out of the tool list given to the CLI (`call-context.ts`).
* `interruptConversation(piSessionId)` is live: it calls `interruptAndSettle`, which is idempotent and a no-op when the CLI has no open turn.
* Pins (o2) not run (real CLI is out of bounds here).
