# Layer-2 handoff (integrator)

Path names in the task were loose; actual locations: the "processes/workspace-service.ts +
worktree-facts.ts" work landed in `packages/core/src/workspaces/`, and the
"core/src/resource-support.ts" probe in `packages/core/src/processes/governor/resource-support.ts`.
`packages/core/src/processes/process-service.ts` and `packages/core/src/processes/sandbox/`
were not touched (other agent's).

## Must-do (blocks green CI)

1. **`packages/testkit/src/contract/resources.ts:57`** — the `[resources] support reports...`
   assertion does a strict `toEqual` on `resourceSupport()`, which now also returns `sandbox`
   (verified live on macOS: `{ enforced: true, mechanism: "seatbelt", tested: true, ... }`).
   Extend the expectation with the `SandboxSupport` shape from `@tau/protocol`'s `sandbox.ts`.
   Until then `core`'s `contract-basics.test.ts` fails on that one case (everything else passes).
2. **`ResourceSupportSchema`** (`packages/protocol/src/resources.ts`) — add
   `sandbox: Type.Optional(SandboxSupportSchema)` (import from `./sandbox`) so the capability
   fields are typed end-to-end instead of riding the response untyped (the server's
   `defineRoute` does not strip extra fields, so they already reach clients; the web agent
   should read `support.sandbox` with a fallback). Re-run `bump-protocol` afterwards.
3. **`process-governor.test.ts` (3 failures: spawn/prepare rejection, slow-prepare stop)** —
   NOT Layer-2 fallout. They fail inside the in-progress `process-service.ts` spawn rewrite
   (`spawnEntry`/`launch`); the stubs there don't touch `describe()`. Owned by the Layer-1 agent.

## Wiring (no code exists yet on purpose — forbidden files)

4. **`create-core.ts`**: pass `hasRunningOf: (id) => processes.hasRunning(id)` into
   `createWorkspaceService` (the `WorkspaceDeps.hasRunningOf?` seam is ready and tested).
5. **`ToolServices.sandbox`** (`core/src/harness/tools/tool-file.ts`, optional, ready):
   build the resolver from settings + conversation docs —
   `scopeOf`: `classifyThread(entry)` when the stored sandbox switch confines that scope,
   else `undefined`; `mcpAllowed`: per-server allowlist check. Until wired, `mcp_call`
   behaves as before (absence = unenforced phase 1).
6. **MCP allowlist persistence** — deliberately NOT added to `SandboxSettingsSchema`:
   `settings-store.ts` `parseSandboxSettings` only parses the 3 flags, so a fourth field
   would not survive restart. Integrator decision: add `mcpAllowlist?: string[]` to the
   schema AND the store parser, or keep the allowlist elsewhere; then feed it to (5).
7. **Edit/write wrapping** (`coding-tools.ts` / `coding-extension.ts`, forbidden):
   wrap pi-durable's `createEditTool()`/`createWriteTool()` with
   `openConfinedWrite(target, root)` / `assertWriteAllowed(target, root)` from
   `harness/tools/sandbox-path.ts`, resolving `root` via `sandboxRootOf(thread)` from
   `workspaces/worktree-facts.ts` (fail closed on `undefined`). `ExecutionEnv.writeFile`
   cannot take `O_NOFOLLOW`, so the wrap must happen at the tool layer, not the env layer.
8. **UNENFORCED marking in the server list** — `McpServerStatus` (`mvp5.ts`) needs an
   explicit confinement state per server for the UI; Layer-2 denies unlisted servers for
   sandboxed threads at call time, but listing still looks trusted.

## Deliberate non-changes

- `SandboxSupport.enforced` means "mechanism present AND the Layer-2 denied-write probe
  passed on this query" — it does NOT reflect the on/off switch (the probe has no settings
  access by design; `describe()` signature unchanged so `process-service.ts` stays untouched).
  The UI combines it with the switch: ON + `enforced` = confined; OFF = staged; mechanism
  `none` = explicit unenforced.
- No enforcement profiles, no network policy, no UI (per constraints).
- `sandbox-mechanism` names (`seatbelt`/`systemd`/`bwrap`) match the Layer-1 agent's
  `SandboxBackend` plus `none`.
