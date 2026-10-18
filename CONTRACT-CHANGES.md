# Contract changes

Phase 1 agents add a short entry here when `packages/protocol/**` or `packages/testkit/**` must change. The integrator applies the entries and clears them.

Entry format: workstream, what to change, why, the exact change.

## Phase 0 deviations

Differences between `MVP2.md` and what Phase 0 left in the repo. Phase 2 reconciles them.

* **`conversations.start` is a bridge, not a stub.** It validates the project (`not_found`, `project_not_ready`) and the provider, then calls the MVP create (empty thread) and `send` with the text. Images, `thinkingLevel`, `requestId` coalescing, the pending-start commit, titles and status are A1's. Reason: the contract suite, the core tests and the CLI need a working first message. The `ModelInfo` check (`invalid_request` for an unlisted model) is missing too.
* **The Home project is implemented in `ProjectStore`** (list, find, require, add-duplicate, rename/remove rejection), not left to A2. Reason: the existing contract cases and the sidebar need Home, and it is one place. A2 owns the rest (kind/status migration of stored records; `toProject` fills `kind: "folder"`, `status: "ready"`).
* **`settings-store` parses a partial file and returns `fastModel: null` and `projectsFolder` (default `<home>/projects`)**; `setFastModel` and `setProjectsFolder` throw `internal` "Not implemented" (A2). Migrations of `app.projects` v2 and `app.conversation` v2 are not done; the doc versions are unchanged.
* **Startup hooks are no-ops, not throwing stubs**: `status.recoverAtStartup`, `clones.recoverAtStartup`, `conversationRecovery.recoverAtStartup`. `status.attach` (called from `beforeResume`) is a no-op. Throwing there would stop the core from starting. Methods that do work (`titles.generateFor`, `clones.clone`, `clones.retryClone`, `archive`, `remove`, `retry`, `listAll`, `setFastModel`, `setProjectsFolder`) throw `internal` "Not implemented: ...".
* **`ConversationStore.removeAllOfProject`** aborts and drops the project's threads from its index (the MVP behavior). A1 replaces it with the tombstone version.
* **Contract cases carry `[tag]`s and `runCoreContract(name, make, { pending })`** registers pending cases as `it.todo`. `core/src/contract.test.ts` lists the A1 and A2 tags. `ContractTarget.paths` gained `cloneUrl()` and `failingCloneUrl()` (the real target uses a local bare repository and `https://127.0.0.1:1/fail.git`; `TAU_ALLOW_FILE_CLONES=1` is set in that test file for the faux core).
* **Fake core title job** always answers with the first three words (it does not model the fast model). The faux provider (`faux-fast`) answers `Title: <first 3 words>`, so the real core gives the same title once A1 strips `Title:`.
* **Image reply**: the faux `image` command answers `Images received: N`.
* **Fixtures**: `image` (one image) and `fail-retry` (a failure, then an `app.retry` input and its answer) were added, `RETRY_PROMPT` lives in `core/src/retry-prompt.ts`. The fake core replays a retry as the `text` fixture with the user entry retagged `app.retry`.
* **`ThinkingLevel`**: equality with pi-ai's `ModelThinkingLevel` is checked at compile time in `protocol/src/entities.ts`.
* **Server**: the new routes are registered, `bodyLimit` is passed from `RouteDef`, and `FST_ERR_CTP_BODY_TOO_LARGE` maps to `too_large`; B still owns the tests for every route and error.
* **Web**: the old empty-thread "New chat" flow is gone. `routes/NewThreadPage.tsx` is a working placeholder (start in the `?project=` / last / Home project with the default model). The sidebar hides rename/remove for Home and drops the "Add a project" hint (Home always exists). `ModelCombobox` now uses the design system `Combobox`. `shadcn add` (tabs, label, switch, alert, field, spinner) added a bogus `cn` dependency; it was removed and the components import `@/lib/utils`. No new npm dependencies were needed.

## Phase 2: applied notes

* A1: `projects-api.remove` emits `{ resource: "conversations", projectId }` after `removeAllOfProject` (the pending-tag constant was already gone).
* A2: `CloneService.stopAll()` kills every running clone group; `create-core.ts` `close()` calls it before closing the harness.
* E: the window-event workaround is replaced by `app/settings-dialog.tsx` (`SettingsDialogProvider`, `useOpenSettings`) used by `AppSidebar` and the palette; `palette/settings-event.ts` is deleted.
* Flaky `run-clone.test.ts`: the test now waits for the fake git to record its pid instead of sleeping 300 ms.

## MVP3 Phase 0 deviations

* **Candidate route uses a query string, supported in `RouteDef`.** `RouteDef` gained `query?: TSchema` and `responseKind?: "json" | "image"`; `GET /projects/:id/icon-candidates/file?name=...` is the only route with a query. `iconCandidateUrl(projectId, name)` builds the `src`. `JsonRouteName` excludes the image routes from `Transport.request`.
* **Core icon candidates have no `index`.** `projects.iconCandidates(id)` returns `{ name }[]` and `projects.iconCandidate(id, name)` takes the name (MVP3.md already says candidates are addressed by name). The REST list adds `url`.
* **`SuggestedCodeFolder` answers JSON `null`.** `defineRoute` sends the literal `null` body for a `null` result.
* **Image routes live in `server/src/rest/define-image-route.ts`** (nosniff, `Cache-Control: no-cache`, ETag with 304, SVG `Content-Security-Policy: sandbox`, 404 without an image) and the icon routes are already wired, so B only adds hardening and tests.
* **`SegmentedControl` is a radio group** (shadcn `ToggleGroup` with `type="single"`: `role="radio"`, `aria-checked`), not two `aria-pressed` buttons. `ToggleGroup`, `Toggle` and `Avatar` were added with the shadcn CLI (its bogus `cn` dependency was removed again).
* **`SidebarThreadRow`** takes `link` (the router `<Link/>`), `avatar`, `context`, `takeover`, `time` and `actions`; it is built from the shadcn sidebar menu, not webr's grid CSS (see the MVP3.md design-system decision).
* **Shared helpers added to `protocol`**: `isIconPng`, `projectIconUrl`, `iconCandidateUrl`, icon size limits.
* **Core stubs (frozen shapes)**: `GithubServiceDeps`/`GithubService` (`github/github-service.ts`, with `extraGitConfig(url)` wired into `CloneService`), `suggestCodeFolder` (`github/code-folder.ts`), `IconService` (`icons/icon-service.ts`), `createRunGh`, `resolveGhPath` and `ghEnvironment` (`github/run-gh.ts`, real). `RunGh` resolves `{ stdout, stderr, exitCode }` for any exit code and rejects only when `gh` cannot run (`code` `ENOENT` or `ETIMEDOUT`). `CoreDependencies` gained `runGh` and `ghPath`. `DataHome` gained `iconsDirectory`.
* **Fake `gh`**: `core/src/test-support/fake-gh/gh` (Node script), `fake-gh.ts` (`installFakeGh`, config types) and `gh-argv.ts` (the two exact argv lists). Config comes from `FAKE_GH_CONFIG`, calls are logged to `FAKE_GH_LOG`. `e2e/support.ts` installs it (two repos cloning from the local bare repository) and puts it first on the server's PATH.
* **Contract**: `ContractTarget.github` (optional) names a repo with and without a local copy; `[github]` and `[icons]` are pending for the real core (`PENDING_TAGS` in `core/src/contract.test.ts`), `[sidebar-data]` is live. The real core's contract target must inject a fake `runGh` through `createCoreWith` and set up a code folder with a copy (A1).
* **`ConversationSummary` sorting**: `useAllConversations` and `useConversations` still sort by `updatedAt`; E switches the sidebar to `lastActivityAt`.

## MVP3 Phase 2: applied notes

* C: `ComposerProps.disabled` blocks Send; `NewThreadPage` passes it while the chosen project is cloning (the "Cloning…" hint stays). `ComboboxOption.hint` is a `ReactNode`; repo options show `RelativeTime`, the code-folder suggestion shows `~`.
* E: `ConversationSummary.model: ModelRef | null` comes from the project index entry (set on start and on `configure`; threads started before this show `null`). The sidebar tooltip shows it. The fake and the contract carry it.
* E: `useConversations` and `useAllConversations` sort by `lastActivityAt` desc (tie: id desc); `sidebar-model.ts` no longer re-sorts. `App.test.tsx` already starts in Projects mode.
* Icons: `writeFileAtomic` accepts bytes and `custom-icon.ts` uses it. `ProjectIconImage` gained optional `etag` (discovered file: mtime-size; custom icon: its hash) and the image route uses it before falling back to a content hash.
* Security: `GithubServiceDeps.allowFileClones` replaces the `process.env` read; `create-core.ts` computes it once (faux and `TAU_ALLOW_FILE_CLONES=1`) for the clone and GitHub services. A test proves a non-faux core drops local clone URLs from gh.

## MVP4 Phase 0a

Frozen: `protocol` schemas and `Core`, the REST table, the `PROVIDERS` table (`core/src/provider/providers-table.ts`: `id`, `name`, `methods`, `keyUrl`, `envVar`, `piProviders[{piId,label}]`, `validate(key, fetch?) -> "valid" | "invalid" | "unknown"`), `ProviderService` (`list`, `setApiKey`, `disconnect`, `listModels`, `lists`, `logins`), `LoginSessions` (`start`, `get`, `submitUrl`, `cancel`), `suggestFiles(folder, query)`, `discoverSkills(projectFolder | null)`, `compactConversation`.

### Deviations from MVP4.md

* `POST /conversations/:id/compact` answers 204 (no body), like every other void route. The web awaits the promise as before.
* `PUT /providers/:id/key` and `DELETE /providers/:id` answer 200 with the `ProviderInfo`. `POST /providers/:id/login` answers 201 with the session; any id but `openai` is `invalid_request`. `/skills` takes `?projectId=` (omitted means user skills only). The login URL body is capped at 4096 characters.
* `submitLoginUrl`: a wrong URL keeps the session `waiting` with `error`; the 5th wrong URL sets `failed`. Submitting to a session that is not `waiting` rejects `login_failed`. `cancelLogin` of an unknown id resolves.
* Faux mode: `models.list()` answers the four `faux` models (`providerName: "Faux"`) as soon as any provider is connected. Faux mode ignores env keys and skips key validation (an empty key is still `invalid_key`).
* Added `FileCredentialStore.writeMany` and `deleteMany` (one atomic write for the OpenCode Zen and Go ids).
* Contract: `ContractTarget` gained optional `writeProjectFile` and `addProjectSkill`. Real core pending tags: `[login]`, `[files]`, `[skills]`. `[providers]` and `[compact]` run for real. The fake's `compact` rejects `nothing_to_compact` until a thread has 2 answers and changes no view; the fake keeps `skills` from `FakeCoreOptions.skills`.
* Faux script: an `Additional focus: fail` summary request answers a provider error (used to test a failing compaction).
* Web (smallest fix, owner 0b replaces it): `lib/api.ts` keeps `api.provider.status/setKey/models` on top of `GET /providers` and `PUT /providers/openrouter/key` (local `ProviderStatus` and `providerStatusOf`); `lib/transport/fake.ts` has handlers for every new route; `lib/use-changed-invalidation.ts` handles `{ resource: "providers" }`. `lib/queries.ts` and `app/App.tsx` needed no change.
* e2e `support.ts` blanks `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENCODE_API_KEY` like `OPENROUTER_API_KEY`.

### Pins

Versions: `@earendil-works/pi-durable@1.3.0`, `@earendil-works/pi-ai@1.3.0` (`dist/` paths below).

1. **Context in the view: nothing is missing, no `pi.context` doc needed.** Real faux conversation, `packages/core/src/context-view.test.ts:59` (threshold, automatic after the third 42k-character message) and `:95` (manual).
   * Summary entry: `{ kind: "pi.compaction", id, head, data: { reason: "threshold" | "manual" | "overflow" }, model: [UserMessage], byTaskId }` (`entries.d.ts:28`). `head` is the id of the first kept entry; the summary sits right before it in `view.entries`, and entries before `head` are gone from `view.entries`. The web draws the "Context compacted" divider at the entry with `kind === "pi.compaction"`.
   * Usage: each `pi.assistant` entry has `model[0].usage = { input, output, cacheRead, cacheWrite, totalTokens, cost }`. After a compaction the last answer is kept with its old usage, so the meter must use the entries after `head` (MVP4.md rule) and may show the stale total until the next answer. `docs["pi.usage"]` is the session ledger and not a context size.
   * Live: `docs["pi.live"].compactions` is `[{ taskId, reason, blocking, attempt, retry? }]` while it runs (`live.d.ts:56,105`): threshold gives `blocking: true` (the run waits), manual gives `blocking: false`. It disappears when the summary is placed. A failed one leaves `compactionFailure: { taskId, reason, error }` (`live.d.ts:110`).
   * Faux sizes: the threshold compaction fires during the third message of 42k characters (the faux model's 128k window).
2. **`SettledTask` and "nothing placed"** (`harness/types.d.ts:50`, `types.d.ts:407`, `harness/types.d.ts:471`). `waitForTask(...)` resolves for every outcome; read `settled.state.outcome`:
   * `{ status: "completed", result: CompactionResult }`; `result` is `{}` (no `entryId`, no `submissionId`) when nothing was placed, so `nothing_to_compact`. Measured on a one-exchange thread: `{"status":"completed","result":{}}`.
   * `{ status: "failed", error: { message, detail: { reason: "model_error" | "no_model" } } }` (`compaction.js:153,384`): summarizer error, token limit, tool call, empty text. `message` is pi's text ("Summarization failed: Simulated provider failure"). Also `faulted` (`error`), `aborted` (`reason?`), `orphaned` (`reason`). `conversation-compact.ts` maps all of them to `internal` with that message, except nothing placed.
3. **`models.getAuth(piId)` source labels** (`auth/helpers.js:19,25`, `auth/resolve.js:118`): stored api key `"stored credential"`; env key the variable name (`"OPENROUTER_API_KEY"`); OAuth `"OAuth"`. A stored credential wins and env is read only without one (`resolve.js:23-36`); `getAuth` resolves `undefined` when unconfigured. The code does not depend on the labels: `connection` comes from `credentials.read` first (`provider/connections.ts`), then `getAuth` decides `source: "env"`.
4. **Validators, status codes with an invalid key** (curl, 2026-10-17, no real keys): OpenAI `/v1/models` Bearer 401; Anthropic `/v1/models` 401; Google `?key=bad` **400** with `"status": "INVALID_ARGUMENT"` (Bearer on Google gives 401); OpenCode `/zen/v1/models` **200 without** the header, 401 with a bad Bearer; OpenRouter `/api/v1/key` 401. Unit tests with stubbed `fetch`: `provider/validators.test.ts`.

### For Phase 1

* **A**: pi aborts the whole ChatGPT login on a bad pasted URL (`openai-chatgpt.js:224-233`: the `manual_code` promise rejects inside `Promise.race`, and `finally` closes the callback server). To keep a session `waiting` after a wrong paste, `login-sessions.ts` must check origin and path itself (the check pi does) before resolving the held prompt, and report a state or code error from pi as `failed`. The faux login (`testing/faux-chatgpt-login.ts`) rejects the same way. `getDeviceId` and the real `models.login` wiring are A's. The `[login]` contract expects the behavior in "Deviations".
* **B**: `compactConversation` is real and tested; B owns the live-state and `coding-extension.ts` parts. `suggestFiles` and `discoverSkills` return `[]`; fill them and remove `[files]` and `[skills]` from `PENDING_TAGS`.
* **Web**: `Change` has a third variant, `{ resource: "providers" }`. `ModelInfo.providerName` is `"Faux"` in faux mode.

## MVP4 Phase 2: applied notes

* `routes/NewThreadPage.tsx` passes `projectId` to `<Composer>` and wires `/model` and `/thinking` through a `PickersHandle` ref.
* `/new` now uses `newThreadPath(projectId)` (`/new?project=<id>`), the URL the new thread page reads. The agent had written `/?project=<id>`.
* `components/ui/combobox.tsx` has a controlled `open` prop; `ModelThinkingPickers` opens its pickers through state, not by clicking the trigger. `NOTES-FOR-INTEGRATOR.md` is deleted.
* e2e: `chat.spec.ts` setup clicks "Add key" and "Save" on the OpenRouter row. `mvp4.spec.ts` covers sections (desktop and phone), add and disconnect a key, ChatGPT success and a wrong address, `/compact` (two 42k-character turns), `@` and the theme after a reload.
* Flaky tests: core and web had the default 5 s Vitest timeout while `pnpm -r` runs all packages at once. Both now set `testTimeout` and `hookTimeout` to 20 s (`packages/core/vitest.config.ts` is new).

## MVP5 Phase 0a

### Protocol

* All schemas of MVP5.md "Contract" exist. New file `protocol/src/mvp5.ts` holds `WorkspaceStatus`, `Checkpoint`, `RestorePreview`, `ProcessInfo`, `McpServerConfig`, `McpServerStatus`. `entities.ts` has `WorkspaceMode`, `ThreadWorkspace`, `MessageMode`, `WhenBusy`, the `ConversationSummary`, `StartConversationInput`, `SendMessageInput` and `Settings` fields, and the two `Change` variants.
* Six error codes (all 409): `thread_busy`, `merge_conflict`, `base_dirty`, `not_on_base`, `worktree_dirty`, `has_unmerged_work`.
* Core gained `conversations.{fork,rewindPreview,rewind,cancelQueued,checkpoints,checkpointDiff}`, `remove(id, options?)`, `workspaces`, `processes`, `mcp`, `settings.{setMessageMode,setWorkspaceDefault}`.

### REST (deviations from the table in MVP5.md)

* Query values are strings (the server runs ajv with `coerceTypes: false`): `?force=true|false`, `?tail=<1..9999>`.
* `DELETE /conversations/:id` also takes `?force=true` (the `remove` option). It is the same route as before.
* Bodies: `POST .../fork`, `.../rewind/preview`, `.../rewind` take `{ entryId }`. `PUT /settings/message-mode` and `/workspace-default` take `{ mode }`.
* Responses: fork 201 `ConversationSummary`; rewind 200 `{ conversation, draft }`; `DELETE .../queue/:itemId` 200 `{ cancelled }`; the diff route answers `{ diff }`; the logs route answers `{ logs }`; merge, pull-request and `DELETE .../workspace` answer 200 `ConversationSummary`; `DELETE /processes/:id`, `PUT` and `DELETE /mcp/servers/:name` answer 204.
* `PUT /mcp/servers/:name`: the path name wins over `body.name`.
* Server: `server/src/rest/register-workspace-routes.ts` (no logic). Tests: `server/src/mvp5-routes.test.ts`.

### Fake core and contract

* Tags: `workspaces`, `checkpoints`, `fork`, `queue`, `subagents`, `processes`, `mcp`. Files `testkit/src/contract/{workspaces,checkpoints,fork,queue,subagents,processes,mcp}.ts`.
* `ContractTarget.paths.gitDirectory?(name)`: a folder that is a git repository with a commit. Cases start threads in it (`startConversation(target, { git: true })`); without it any folder counts. The real core target must provide it in Phase 1.
* Faux triggers the real core's faux script must support for these cases: `write ...` and `edit ...` change a file (worktree becomes dirty); `commit ...` commits (fake only; no contract case needs it); `task <description>` makes the agent call `task` (child thread titled `<description>`, `parentId` set); `bg <command>` makes the agent call `process_start` with that command; `bash sleep 30` keeps a run busy.
* Fake rules: every project but Home is "git" and gets a worktree at `/fake/home/.tau/worktrees/<project>/<slug>` on `tau/<slug>`, base `main`. A fake `write`/`edit` run adds `hello.txt` to the dirty files and to the `after` checkpoint (status `A`); merge needs a clean idle worktree; remove or delete with unmerged work needs `force`; a removed worktree keeps `mode: "worktree"`, `state: "removed"` and `path` = project path. Checkpoint ids are `<requestId>:before|after`; `entryId` is the id of the thread's n-th user entry. `rewind` forks before the entry (`forkOf` set, title `Fork of ...`) and refuses with `thread_busy` while any thread with the same path runs. Queued inbox items carry `id` (the `itemId`) and `mode`. Children of a thread are archived and deleted with it. `mcp.servers(projectId)` knows only settings servers (no `.mcp.json`).
* `settings.get()` now includes `messageMode: "steer"` and `workspaceDefault: "worktree"`; the existing "starts without a key" case checks them.

### Core (minimum to compile)

* `core/src/mvp5-stubs.ts`: `notImplemented` stubs for the six conversation methods, `workspaces`, `processes`, `mcp`; `settings.setMessageMode/setWorkspaceDefault` reject the same way (`settings-api.ts`).
* `toSummary` (`harness/conversation-index.ts`) returns the legacy defaults, but with `workspace.path: ""`. 0c must fill it with the project path (it has no project at that point).
* `home/settings-store.ts` `withDefaults` returns `messageMode: "steer"`, `workspaceDefault: "worktree"` (not stored yet; 0c adds storage).
* `core/src/contract.test.ts` `PENDING_TAGS` lists the seven new tags. `conversations.remove(id, options)` ignores `options` in the real core.

### Web (smallest type fixes)

* `lib/api.ts`: `removeConversation` request gets `query: {}`.
* `lib/transport/fake.ts`: handlers for all 18 new routes (`Input` gained `itemId`, `cid`, `name`, `path`, `tail`, `force`).
* `lib/use-changed-invalidation.ts`: `processes` and `mcp` changes are ignored for now (they have no `projectId`).
* Test fixtures: `sidebar/test-support.tsx` (`conversation()` has the three new fields), `sidebar/AppSidebar.test.tsx`, `sidebar/modes.test.tsx`, `lib/api.test.ts` (settings fields). Core: `home/settings-store.test.ts` defaults.

## MVP5 Phase 0c

### Core foundation

* Stubs live in the folders MVP5.md names; each exports a factory Phase 1 fills: `workspaces/workspace-service.ts`, `checkpoints/checkpoint-service.ts`, `processes/process-service.ts`, `mcp/mcp-service.ts`, `harness/conversation-fork.ts`, `harness/conversation-submit.ts` (`cancelQueued`), `harness/tools/*`, `harness/pi-extension-adapter/pi-extension-adapter.ts`. `mvp5-stubs.ts` is gone; `create-core.ts` wires the services.
* `harness/registry.ts` has one import per tool file. Each file exports a `ToolFileFactory` returning `{ implemented, extension }`; the registry installs only `implemented: true`, so stubs never reach a running conversation. Phase 1 flips the flag in its own file. Tools read services lazily through `ToolServicesRef` (`harness/tools/tool-file.ts`).
* Cleanup: `removal-hooks.ts` (`RemovalHooks`: `unmergedWork`, `onConversationRemoved[]`, `onProjectRemoved[]`) is built in `create-core.ts` and used by `conversation-removal.ts` and `projects-api.ts`. `conversations.remove(id, { force })` throws `has_unmerged_work` unless forced (children skip the guard; they go with the parent). `projects.remove(id)` has no force in the frozen protocol, so it runs the guard unforced: a project with unmerged work cannot be deleted until the protocol gains a force option.
* Index entries (`conversation-docs.ts`) carry `workspace`, `forkOf`, `parentId`. `toSummary(project, entry)` defaults to `legacyWorkspace(project.path)`, never `""`. `createConversationStore(harness, projectPathOf)`. New store methods: `find`, `setWorkspace` (also sets the agent cwd), `cancelQueued`, `send(..., whenBusy)`. `StartRequest` has `workspace` and `beforeFirstInput`. `harness/conversation-child.ts` has `registerChildConversation(tx, ...)` for task children.
* Settings store persists `messageMode`, `workspaceDefault`, `mcpServers` (`mcpServers()`, `saveMcpServer`, `removeMcpServer`); `mcp-api.ts` persists save/remove and drops the pooled connection.
* `send` resolves `whenBusy` from the input, else from `messageMode` (`queue` is `followUp`). `start` calls `workspaces.create` with `input.workspace ?? settings.workspaceDefault`.
* `conversations-mvp5-api.ts` only delegates (`fork`, `rewind*`, `checkpoints*`, `cancelQueued`), so no Phase 1 agent edits `conversations-api.ts`.
* Not wired (needs an owner): the run-end `checkpoints.snapshotAfter` call from the status tracker. `snapshotBefore` runs in `send` and (via `beforeFirstInput`) in `start`.
* Contract target: `paths.gitDirectory` is a temp repo with one commit. Faux script: `task <description>` calls `task`, `bg <command>` calls `process_start` (`testing/faux-script.ts`); `write`, `edit`, `bash sleep` already existed. `commit ...` is fake-only. Until a tool is implemented its faux trigger ends in a tool error and "Done.".
* New deps in `packages/core`: `@modelcontextprotocol/sdk@1.32.1`, `pi-web-access@0.42.0`, `@earendil-works/pi-coding-agent@1.3.0`, `@earendil-works/pi-tui@1.3.0`.

### Pins (`packages/core/src/harness/mvp5-pins.test.ts`, versions as above)

1. **Fork copies the agent doc as of the fork entry** (`:96`). A parent whose cwd was changed after the entry forks with the old cwd and the same model; the parent keeps the new one. Matches `pi-durable/README.md:305`.
2. **`whenBusy: "followUp"`** (`:110`). While a `bash sleep 1` run is busy, `store.send(..., "followUp")` puts `{ mode: "followUp" }` in `pi.inbox` (`dist/harness/inbox.d.ts:7`); it is placed only after the run's final answer (the second `pi.user` entry comes after the first run's last assistant entry), as `applyBoundary` documents (`inbox.d.ts:44`). `steer` is the default and lands at the next tool boundary.
3. **Abort on delivered items** (`:110`). `harness.abortSubmission(itemId, BACKGROUND)` (`dist/harness/types.d.ts:660`, same result as `Submission.abort`, `:48`) answers `"aborted"` for a queued item and `"already_placed"` or `"settled"` once delivered; the inbox item id is the submission id, so `cancelQueued` maps `"aborted"` to `{ cancelled: true }` and everything else to `{ cancelled: false }`.
4. **Task ownership** (`:131`). A tool `commit` does `tx.createConversation({ ownership: { kind: "task", taskId } })`, `configure(tx, id, { extensions: { remove: [ext] } })` and `registerChildConversation(tx, ...)` in one tx; `store.list` returns the child with `parentId`, `store.find` (the `known()` path) finds it, its cwd is the parent's, its agent lacks the `task` extension and the parent's keeps it. Rerun lookup uses `tx.scanConversations({ ownerTaskId })` (README "Abort and Subagents").
5. **pi-web-access through a fake `ExtensionAPI`** (`harness/pi-extension-adapter/pi-web-access.pin.test.ts:27`). Import `pi-web-access/dist/index.js` (no `main` or `exports`; the package lists `./dist` under `pi.extensions`); its default export runs with a Proxy API (only `registerTool` records, everything else is a no-op) and no network. Tools: `web_search` (`query`, `queries`, `numResults`, `includeContent`, `recencyFilter`, `domainFilter`, `category`, `provider`, `workflow`, `proxy`), `source_check` (`claim`, `queries`, `numResults`, `fetchContent`, `recencyFilter`, `domainFilter`, `provider`, `proxy`), `fetch_content` (`url`, `urls`, `forceClone`, `prompt`, `mode`, `answerModel`, `timestamp`, `frames`, `model`, `auth`, `proxy`, `redirects`), `get_search_content` (`responseId`, `query`, `queryIndex`, `url`, `urlIndex`, `offset`, `limit`, `findText`, `findMode`). Parameters are TypeBox/JSON Schema objects with `properties`. The OpenRouter web plugin is no longer needed.

## MVP6 Phase 0

Pins: `packages/core/src/harness/mvp6-pins.test.ts` (pi-durable 1.3.0, faux). All pass; no alternative was needed.

* (a)(c) After `agent` returns, the child's `pi.live.run` is still set and the parent is idle (`waitForIdle` resolves). Child owned by an `Anchor` (conversation-owned, `background: true`) created in the same `api.commit` as the child.
* (b) `store.abort(parent)` during a later parent run leaves the child running; its notification arrives with status `done`.
* (d) `harness.close` then reopen mid-child: one child user entry, exactly one `app.subagent_notification` in the parent.
* (e) A legacy `task` call in flight under a registry where `task` has default callers replays after the restart under `callers: ["tools"]`: one child, no error result. No startup `configure` migration is needed. Side effect: the model cannot call a `callers: ["tools"]` tool, so tests and contract cases that make the model call `task` use `LEGACY_TOOL_FILES` (task tests) or the pending tag `[subagents-task]` (contract).
* (f) The registry doc `app.subagents` maps `callId` to child. A second `startBackgroundChild` with the same `callId` returns the same child (one child, one reporter). A tool that throws right after the commit (simulated crash) leaves one child after the restart and one notification. A real kill inside the tool cannot be simulated: `harness.close` waits for a hung tool.
* (g) Notification waiting in the parent's inbox (parent busy) across a restart: one entry. Two submits with the same `requestId` make one entry.
* (h) `tx.forkConversation(parentId, newestEntryId, { ownership: { kind: "task", taskId: anchor } })` in the same commit as the anchor: the child keeps the parent's history and reports back. `tx.scanEntries` must run before the first write in the tx (`ReadAfterWrite`). The newest parent entry is the in-flight `fork_agent` tool call, so Phase 1 should fork at the last entry before it.

Protocol: `ConversationSummary` += `agentType`, `agentModel`, `agentStatus`, `background` (legacy: null, null, null, false). `AgentStatus`, `SUBAGENT_NOTIFICATION_KIND`, `SubagentNotificationDataSchema` exported. `Core.conversations.stopAgent` and `POST /conversations/:id/stop-agent` (204; 404 unknown; 400 not a child). Contract tags `[subagents-v2]` (pending in both targets), `[subagents-task]` (pending in the real core), `[subagents]` stop and defaults cases run.

Core: `harness/subagent-{runtime,anchor,reporter,registry-doc,notification,stop}.ts`; `agents/{agent-types,model-alias}.ts` stubs; tool stubs `agent`, `send_message`, `stop_agent`, `list_agents`, `merge_agent` (`implemented: false`); `ToolServices.connectedModels()`; removal now removes children before the parent; archiving aborts children.

## MVP6 Phase 2: applied notes

* Integrator notes applied; both NOTES files removed. `PENDING_TAGS` is empty in the real core and the fake core. The fake `agent` trigger replaces `task` in contract cases; `[subagents-task]` cases now run as `[subagents]` on `agent`.
* `list_agents` also returns `details.agents[]`; the web cards read `details.conversationId` and `details.agents[]` (pinned in `subagent-tools.test.ts`).
* Faux triggers: `agent-fork <prompt>` (fork subagent) and `agents` (`list_agents`). `e2e/tests/mvp6.spec.ts` covers two background subagents, Stop, the child page, a fork and the list card.
