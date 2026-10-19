# Settings: per-node tabs (plan) — v3 (final, reviewed twice)

## Problem

`Settings → Tools` throws `"Project not found."` when the currently open
conversation lives on a different node than the one the Settings dialog is
querying.

Root cause (`packages/web/src/settings/tools/ToolsSection.tsx`):
- It reads `projectId` from `useOpenConversation()` (the open conversation's
  route params), which also carries a `nodeId` when the conversation is on a
  remote node.
- It ignores that `nodeId` and calls `useApi()`, which resolves through
  whatever `NodeContext` the component tree is mounted in. The global
  `SettingsDialog` (`app/settings-dialog.tsx` → `settings/SettingsDialog.tsx`)
  is never wrapped in a `NodeProvider` for the conversation's node — it always
  runs in the hub's own node context.
- So `useMcpServers(projectId)` asks the **wrong node** for a project that
  only exists in **another node's** project store, and the harness there
  throws `AppError("not_found", "Project not found.")`
  (`core/.../createProjectStore` → `notFound$8`).

## Decisions (agreed with user, do not relitigate)

- **Settings must never depend on the currently open conversation/project.**
  Opening Settings is not project-specific, full stop.
- Each node owns its own Providers, Models, Projects, GitHub link, Agent
  defaults, Tools (MCP servers). Since we have full read/write power over
  every linked node, Settings should let the user view and edit **any**
  node's settings directly for these, not just the one the browser happens
  to be attached to.
- The project's own `.mcp.json` servers are not a *setting* — tau just
  supports them automatically wherever a project has one. Settings has no
  reason to display or manage them. Drop that list from `ToolsSection`
  entirely; it does not reappear anywhere else as part of this plan. This
  also means `use-setting-entries.ts`'s MCP-server search index must stop
  filtering by the open conversation's `projectId`.
- The existing `NodeSettingsDialog` (a separate modal opened via a gear icon
  on a node row in `NodesList`) is retired. Its job — a per-node settings
  surface wrapped in the right `NodeProvider` — is absorbed into the main
  `SettingsDialog`, available for every node, with a fuller section set
  (today `NodeSettingsDialog` only has Providers/Projects/Connectors).

## Target structure

`SettingsDialog` sidebar becomes two groups:

1. **App-level** (genuinely not a node concept, confirmed against the
   server's own proxy rules — see "Remote access" below):
   - **General** (`AppearanceSettings` + `NotificationSettings`): browser/
     device-local state, no per-node storage. No surprises found.
   - **Nodes** (the pairing/connect/disconnect/forget UI): mesh membership
     management, not one node's config; its data
     (`useNodes()`/`hubApi.nodes.directory()`) is read from "this browser's
     view of the mesh."
   - **Remote access + Devices** (`RemoteSection`: `RemoteAccessRow`,
     `LinkDeviceRow`, `DevicesSection`): **stays app-level / "this node"
     only. Do not move it into the per-node tab set** — see hard blocker
     below. This reverses the v2 draft of this plan, which wrongly proposed
     moving it per-node.
2. **Per-node tabs**: "This node" + one entry per node from `useNodes()`.
   Selecting a node tab shows that node's own: Providers, Models, Projects,
   GitHub, Agent, Tools.
   - "This node" needs **no new plumbing**: `apiOfNode(undefined)` already
     resolves to `localApi` (`node-apis.ts:9`), and today's `SettingsDialog`
     already runs unwrapped (= implicitly "this node"). The actual new work
     is wrapping the per-peer tabs in `NodeProvider nodeId={id}`.
   - Every query/mutation for per-node sections must run through this
     `NodeProvider`, so switching tabs never requires closing and reopening
     Settings, and components keep using plain `useApi()` unchanged.

### Hard blocker found and resolved: Remote access/Devices cannot be proxied to peer nodes

`packages/server/src/nodes/path-filter.ts` denylists `access`, `remote`,
`nodes`, `update`, `pair`, `health`, `n` as `DENIED_FIRST_SEGMENTS`, with the
comment "Routes that must never cross the hub: they would show or change the
hub's own data." This is enforced in the hub's proxy
(`registerNodeProxy`/`filterProxyPath`), independent of where
`DataHome.remoteDirectory` itself is stored. So `apiOfNode(peerNodeId).remote.status()`
(proxied through `/api/n/<id>/remote`) **403s by server design, for every
peer node, always**. This is a real server-side restriction, not a client
wiring gap — moving Remote access/Devices into the generic per-node tab set
as originally drafted is not implementable without new, out-of-scope proxy
allow-list work.

**Resolution: Remote access and Devices remain exactly where they are
today** — app-level, operating on "this node" only, same as `General` and
`Nodes`. This plan does not touch `RemoteSection.tsx`, `RemoteAccessRow.tsx`,
`DevicesList.tsx`, or `LinkDeviceRow.tsx` at all. (If per-node remote access
management is ever wanted, that is a separate, explicit proxy-allow-list
project — not in scope here.)

### Settings search: cross-node fan-out is out of scope — explicitly descoped

Walking the click path end-to-end (`SettingsDialog.tsx` → `openEntry` →
`settingTarget` → `use-reveal-setting.ts`'s `data-setting-id` scroll):
today's dynamic search entries (`use-setting-entries.ts`'s `dynamicEntries`
for providers/projects/models/mcp servers) are built from a single
`useApi()`'s data — one node's worth. Making search cover every linked
node's dynamic entries would require fetching providers/models/projects/mcp
servers for **N different `Api` clients in parallel**, then qualifying each
resulting `SettingEntry` with a node id end-to-end through
`settingTarget`/`onSettingOpen`/`useRevealSetting`/`SectionBodies` lookup —
a materially bigger change than this plan's scope.

**Resolution: descope.** Settings search continues to index only "this
node"'s dynamic entries (providers, projects, models, MCP servers) plus the
fixed `SETTINGS_INDEX` rows, exactly as `use-setting-entries.ts` does today
— just with `projectId` dropped (see below). Peer-node tabs are reachable by
clicking them directly in the sidebar, not via search. This is a real,
visible limitation worth calling out to the user before merging (search
won't find "that provider I set up on my server"), but is deliberately out
of scope for this plan; revisit as a separate follow-up if it matters in
practice.

`ToolsSection` and `use-setting-entries.ts` changes:
- Remove `useOpenConversation` import and usage entirely from both.
- Remove the "From this project's `.mcp.json`" `ServerList` and the
  `source === "project"` filtering/branch from `ToolsSection`.
- `useMcpServers` keeps its `projectId: string | null` parameter (server
  route confirmed: `projectId` is `Type.Optional` in `listMcpServers`'s
  query schema at `packages/protocol/src/rest.ts:745` — no protocol/server
  change needed, this is purely a client-side call-site change). Both
  callers just always pass `useMcpServers(null)` now instead of
  `useMcpServers(projectId ?? null)`.

### Offline / unreachable node tabs

`DirectoryNode` status includes `offline`, `reconnecting`, `unreachable`,
`update-required` (not just `online`). Add one shared guard component
(e.g. `NodeSectionGuard`) used once per per-node section body: it calls
`useNodeContext()` (for the current tab's `nodeId`) + `useNodes()` (for that
node's live status) and renders a lightweight status notice (reuse
`StatusChip`/whatever `NodeItem` already uses) instead of mounting the real
section when the node isn't `online` — so `useProviders`/`useModels`/
`useMcpServers`/etc. never fire a doomed call against a dead node. "This
node" never needs this guard (always reachable). One wrapper, used per
section render — no redundant per-component `useNodes()` calls needed, and
no change to `NodeProvider` itself required.

### URL state for the selected node tab

`SettingsDialogProvider`'s URL state lives in the same `useSearchParams()`
as the rest of the page. **Do not use the query key `node`** —
`packages/web/src/lib/paths.ts` and `MainLayout.tsx`'s new-thread draft flow
already own `?node=<id>` for picking a thread's target node, read on every
render of `NewThreadRoute`; reusing the same key would let Settings and the
new-thread picker silently stomp each other's value. Use a distinct key,
e.g. `settingsNode`, alongside the existing `settings=<section>` param.
(Reusing the `/n/:nodeId/...` path convention, as one reviewer suggested, is
wrong here: Settings is a dialog overlay on top of whatever route/path is
already active — including conversation routes that already own their own
`/n/:nodeId/p/:projectId/...` segment — not a page of its own; a query param
is the right mechanism, it just needs a non-colliding name.)

## Files expected to change

- `packages/web/src/settings/SettingsDialog.tsx` — sidebar restructure into
  app-level (General, Remote access, Nodes) + per-node tab list; node
  switching via `settingsNode` URL param; mount `NodeProvider` +
  `NodeSectionGuard` around the per-node body.
- `packages/web/src/settings/sections.ts` — split section ids: a small
  fixed `APP_SECTIONS` (general, remote, nodes) and a `NODE_SECTIONS` list
  (providers, models, projects, github, agent, tools) reused for every node
  tab. Active-section state becomes something like
  `{ kind: "app", id } | { kind: "node", nodeId: string | undefined, id }`
  instead of one flat `SettingsSectionId`.
- `packages/web/src/settings/section-bodies.tsx` — `SECTION_BODIES`'s
  zero-arg `Record<SettingsSectionId, () => ReactNode>` shape must change to
  accept the active node (e.g. `Record<NodeSectionId, (nodeId?: string) =>
  ReactNode>`), with each per-node body wrapped in `NodeProvider
  nodeId={...}` + `NodeSectionGuard`. App-level bodies (general, remote,
  nodes) keep the old zero-arg shape. Update the `SECTION_BODIES[section]()`
  call site in `SettingsDialog.tsx` accordingly.
- `packages/web/src/settings/tools/ToolsSection.tsx` — drop project
  awareness as above.
- `packages/web/src/settings/use-setting-entries.ts` — drop
  `useOpenConversation`/`projectId` entirely; call `useMcpServers(null)`
  unconditionally; dynamic entries remain scoped to "this node" only (search
  fan-out explicitly descoped, see above).
- `packages/web/src/settings/NodeSettingsDialog.tsx` — delete.
- `packages/web/src/settings/NodesList.tsx` — remove the gear icon /
  `onSettings` wiring that opened `NodeSettingsDialog`.
- `packages/web/src/settings/NodeItem.tsx` — remove the `onSettings` prop
  and its call site.
- `packages/web/src/settings/settings-index.ts` — only needs to handle "this
  node"'s dynamic entries, same shape as today (no node-id qualification
  needed now that cross-node search is descoped) — smaller change than v2
  of this plan assumed.
- `packages/web/src/settings/settings-dialog-search.test.tsx` — its
  "settings index coverage" test loops over the old flat
  `SETTINGS_SECTIONS` asserting a 1:1 id-to-section mapping; update its
  model to the new `APP_SECTIONS`/`NODE_SECTIONS` split (every node section
  still only needs one coverage check, since search only looks at "this
  node").
- `packages/web/src/settings/tools/ToolsSection.test.tsx` — update for
  dropped project-list rendering.
- `packages/web/src/app/settings-dialog.tsx` — add the `settingsNode` URL
  param (distinct from the existing `node` param owned by new-thread) so
  back/forward and reload keep the selected node tab, not just the section.

## Explicitly out of scope

- Any proxy allow-list change to let Remote access/Devices be viewed or
  changed for a peer node — blocked by `path-filter.ts`'s
  `DENIED_FIRST_SEGMENTS`; not attempted here.
- Making Settings search cross-node — descoped above; search stays
  "this node" only.
- Scopes/permissions per node (not building access control here — plan
  continues to assume "full power over every linked node," per existing
  project decisions in `PLAN.md`).
- Changing how `useNodes()`/`NodeRegistry` itself works — reused as-is.
- `NodeProvider`'s module-level `remoteClients` cache is shared between
  Settings per-node tabs and the main app's per-node thread views for the
  same `nodeId` — existing, desired behavior, not something this plan needs
  to change, just something an implementer should know rather than be
  surprised by.
