# Foundation notes (Phase 1)

## Frozen contract
- `protocol/src/resources.ts`: `ResourceSettings`, `DEFAULT_RESOURCE_SETTINGS`, `ResourceSupport`
  `{platform: linux|macos|other, memoryEnforcement: kernel|polled|none, prioritySupported, sameCgroupOnly, note}`,
  `ResourceCommand {entryId, conversationId, conversationTitle, command, since}`, `ResourceActivity {holders, waiting}`,
  limits `HEAVY_SLOTS_MIN/MAX`, `MEMORY_LIMIT_MIN_MB`.
- `Core.settings`: `setResources(value)`, `resourceSupport()`, `resourceActivity()`, `stopResourceCommand(entryId)`.
  Routes: `PUT /api/settings/resources`, `GET .../resources/support`, `GET .../resources/activity`,
  `DELETE .../resources/activity/:id` (not owner-only). Change variant `{resource:"resources"}`. `ProcessInfo.state` has `queued`.
- Core: `processes/process-types.ts` (`StopReason`, `ExitDetails`, `ForegroundOutcome`, `ForegroundRun.admitted`), re-exported
  from `process-service.ts` and `running-process.ts`. `RunningProcess.stopReason?`, `governed?` on both requests,
  `ProcessDeps.emitResourcesChange?`. `admitted` is `Promise.resolve()` for now; nothing sets `stopReason` yet.

## Deviation from the plan (decision for the integrator)
`Settings.resources` is `Type.Optional` in `SettingsSchema`. The web transport validates every response against the schema
(`web/src/lib/transport/http.ts` `assertResponse`), so a required field would make `getSettings` from an older node fail
entirely. A current node always sends it (`withDefaults`, fake core). Web: `settings.resources === undefined` = not supported.
Also the transport maps a plain 404 to `AppError("internal", "Request failed (404)")`; `api.settings.resourceSupport()` and
`resourceActivity()` therefore return `null` on 404/not_found (older node), they never throw for that.

## Core agent
- `settings-api.ts`: `onResourcesChanged?(value)` is called after the store write. Stubs to replace: `resourceSupport`,
  `resourceActivity`, `stopResourceCommand` (`UNSUPPORTED_RESOURCES`). `setResources` validates with the TypeBox schema.
- `settings-store.ts` exports `parseResourceSettings` (per-field fallback to Off defaults) for loading `resource-state`.
- Plan sentence "core agent adds `governed?`" is already done (foundation added it, unused).
- Nothing is wired in `create-core.ts`.

## Web agent
- `ResourcesGroup` (`web/src/settings/resources/ResourcesGroup.tsx`) is mounted in `AgentSection.tsx` and renders null.
- Hooks in `lib/queries.ts`: `useResourceSupport`, `useResourceActivity(enabled)`, `useSetResources`,
  `useStopResourceCommand`; keys `queryKeys.resourceSupport`, `queryKeys.resourceActivity`. `null` data = old node.
- `settings-index.ts` ids: `resources-priority`, `resources-heavy-slots`, `resources-memory-limit`, `resources-applies-to`
  (section `agent`); use them as `SettingRow id`.
- Testkit: `createFakeCore().seedResourceActivity({holders, waiting})`; `fakeProcesses.queue()` makes a `queued` entry.
