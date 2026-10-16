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
