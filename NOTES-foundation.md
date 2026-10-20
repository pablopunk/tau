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

## Deviations found at the end
- `settings-index.ts` has NO `resources-*` entries yet: `settings-dialog-search.test.tsx` requires a rendered row for every entry and the placeholder renders null. Web agent: add these entries together with the rows (avoid the word "machine": `vocabulary.test.ts`):
```ts
  {
    id: "resources-priority",
    section: "agent",
    label: "Command priority",
    description: "Run agent commands at a lower CPU priority so the computer stays usable.",
    keywords: [
      "resources",
      "cpu",
      "nice",
      "priority",
      "background",
      "balanced",
      "slow",
      "stutter",
      "taskpolicy",
    ],
  },
  {
    id: "resources-heavy-slots",
    section: "agent",
    label: "Heavy command slots",
    description: "Only this many heavy commands (tests, builds, typechecks) run at once; the rest wait.",
    keywords: ["resources", "concurrency", "queue", "slots", "parallel", "tests", "build", "limit", "heavy"],
  },
  {
    id: "resources-memory-limit",
    section: "agent",
    label: "Memory limit per command",
    description: "Stop a command that uses more memory than this.",
    keywords: ["resources", "memory", "ram", "oom", "limit", "kill", "runaway"],
  },
  {
    id: "resources-applies-to",
    section: "agent",
    label: "Apply resource control to",
    description: "Main checkout threads, worktree threads and subagents.",
    keywords: ["resources", "apply", "subagents", "worktree", "main checkout", "threads"],
  },
```
- `App.test.tsx` "This node" (2 tests) fails on this base (cdb4338); main 08bca9c fixes it (`aria-hidden` on `NodeAvatar` in `SettingsNav.tsx`). Not related to this work; resolved by merging main.
