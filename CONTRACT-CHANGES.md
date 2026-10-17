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
* **Contract cases carry `[tag]`s and `runCoreContract(name, make, { pending })`** registers pending cases as `it.todo`. `core/src/contract.test.ts` lists the A1 and A2 tags. `ContractTarget.paths` gained `cloneUrl()` and `failingCloneUrl()` (the real target uses a local bare repository and `https://127.0.0.1:1/fail.git`; `PI_EVERYWHERE_ALLOW_FILE_CLONES=1` is set in that test file for the faux core).
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
* Security: `GithubServiceDeps.allowFileClones` replaces the `process.env` read; `create-core.ts` computes it once (faux and `PI_EVERYWHERE_ALLOW_FILE_CLONES=1`) for the clone and GitHub services. A test proves a non-faux core drops local clone URLs from gh.

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
