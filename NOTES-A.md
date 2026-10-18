# Notes from owner A (connectors core)

* `claude-connector.ts` has `execute` but keeps `implemented: false`. Flipping it installs the tool in every thread (the registry offers all installed tools) and breaks `pin-p-unoffered-connector-tool.test.ts` plus other tool-list tests. Integration flips it together with the `AgentDoc.tools` offering and updates pin (p).
* `execute` keys the observed result by `api.callId` (the Pi tool call id, equal to the CLI `tool_use` id by the mapping) and finds the Pi session id with `api.snapshot(ProviderDoc, api.conversationId, context)` before calling `interruptConversation`.
* Integration: build the tool services with ONE shared `ObservedResultStore` (`createConnectorToolServices()`), give the same store to owner B's pump (`settle`), and set `interruptConversation` to the streamer's. `ToolServices.claudeConnectors` is still the inert stub in `create-core.ts`.
* Owner B: call `chooseServers(settings, status)` with the live query's `mcpServerStatus()` for `allowedTools` and chosen names; `names` lists only connected servers.
* Contract tag `claude-connectors` stays in `PENDING_TAGS`: the real core needs B, C and integration first.
* `provider-service.ts` needed no change: `claude-cli/service.ts` already calls `createConnectorProbe`, `refresh()` on Check again and `current()` in the status.
