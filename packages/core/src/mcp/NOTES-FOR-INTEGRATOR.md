# Notes for the integrator (agent D)

* `create-core.ts`: pass `emitChange: () => changes.emit({ resource: "mcp" })` to `createMcpService` so status changes (connected, error, idle) reach the web.
* `contract.test.ts`: remove `"mcp"` from `PENDING_TAGS`. The `[mcp]` contract cases pass against the real core with it removed (verified locally, then reverted because the file is not mine).
* `web/src/lib/queries.ts` and `SettingsDialog.tsx` were left alone: `ToolsSection` reads the open project from the route (`useOpenConversation`) and keeps its own save/remove mutations in `settings/tools/use-mcp-mutations.ts`.
* `web_search` with no `provider` uses pi-web-access's own auto order, which may pick a provider from the user's `~/.pi/web-search.json` (seen: Gemini). Keyless Exa works with `provider: "exa"` (smoke-tested).
* Tool card map (`ToolCall.tsx`): `source_check` is not mapped and renders generically.
