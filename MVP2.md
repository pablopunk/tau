# MVP2 plan

Status: APPROVED v5 (review rounds 1–3 applied; basic harness features added after a survey of webr, T3 Code and OpenCode). Builds on [MVP.md](MVP.md) (architecture, security, testing rules still apply). Product context: [PLAN.md](PLAN.md).

## Goal

> Open the app → type a prompt (with images) on the new thread page → pick a project (or none), a model and a thinking level → the thread starts, gets a good title by itself, and works in that folder. Projects can also come from a git URL. The basics every agent app has are there: thread status, archive/delete, copy, retry, notifications, search.

Same quality bar as the MVP: small scope, built to last, parallel agents.

## Scope

In:
1. **New thread page**: one page with the composer (text, images by button, paste or drop), a project menu, a model menu and a thinking-level menu. Sending creates the thread and its first message in one call.
2. **No project**: a built-in "Home" project at the user's home folder (`os.homedir()`). Default the first time; after that the menu starts on the last project used.
3. **Images**: attach images to any message, shown in the transcript and in queued messages.
4. **Auto thread titles**: the fast model names each thread from its first message; without a fast model, the thread's own model does it.
5. **Git projects**: add a project from a git URL; the app clones it into the projects folder.
6. **Settings**: fast model, projects folder, notifications, in the existing settings dialog.
7. **Model and thinking level per thread**: chosen on the new thread page, shown in the composer toolbar.
8. **Archive and delete threads**.
9. **Thread status in the sidebar**: running, error, and "done, not seen yet".
10. **Copy and retry**: copy any message and code block; retry after a failed or stopped answer.
11. **Notifications** when a run ends and the page is hidden (opt-in per browser).
12. **Command palette** (`Mod+K`) and shortcuts (`Mod+Shift+O` new thread, `Esc` stop).

Out (later, see PLAN.md): machine choice, image model fallback, image file store, fork/edit message, editing queued messages, mobile keyboard polish, context meter, remote access, terminals, worktrees, other providers, per-project settings.

## Product decisions

- Empty threads no longer exist. "New thread" (sidebar header, per project, palette, `Mod+Shift+O`) opens the new thread page; a thread is created only when its first message is sent.
- The Home project is always first in the sidebar and the menu. It cannot be renamed or removed. Adding the home folder as a project is a duplicate.
- Per browser (localStorage, through `lib/preferences.ts`): last project (falls back to Home if gone), last model and thinking level, notifications on/off, `lastSeenAt` per thread.
- Composer drafts: text per target (new page, each thread) in localStorage; images in memory.
- Thinking level default: `"medium"` clamped to what the model supports; `"off"` for models without reasoning. MVP threads read as `"off"` (Pi's default).
- The model and thinking level can be changed at any time from the composer; a change applies from the next model request.
- Archiving keeps a running thread running; the archived row still shows its status. Sending to an archived thread unarchives it.
- Deleting removes the thread from the app. Pi has no conversation delete, so its transcript (and images) stay in `agent.sqlite` until Pi can purge; the confirm dialog says so.
- Removing a project never deletes its folder, also for cloned projects. The dialog says where the folder is.
- Projects folder default: `~/.tau/projects` (the user's choice in PLAN.md: touches none of the user's folders). The settings dialog shows the path and warns that deleting the data home deletes cloned repos.
- Images travel as base64 in the JSON body (localhost only). Every view reset re-sends them; a file store and upload route come later.

## Contract (`packages/protocol`)

### Entities
```ts
ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  // hand-written TypeBox union + a compile-time equality check against pi-ai ModelThinkingLevel
ModelInfo += { images: boolean; thinkingLevels: ThinkingLevel[] }
  // images: model.input.includes("image"); thinkingLevels: pi-ai getSupportedThinkingLevels(model)
Settings = { defaultModel: ModelRef | null; fastModel: ModelRef | null; projectsFolder: string }
Project = { id; name /* display only */; path; createdAt;
  kind: "home" | "folder" | "git"; gitUrl?: string; status: "ready" | "cloning" | "failed"; error?: string }
ConversationStatus = "idle" | "running" | "error"
ConversationSummary = { id; projectId; title; createdAt; updatedAt;
  archivedAt: number | null; status: ConversationStatus; lastRunEndedAt: number | null }
ImageInput = { mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string /* base64, maxLength 5 MiB */ }
SendMessageInput = { text: string /* no minLength */; images?: ImageInput[] /* maxItems 8 */; requestId: string }
StartConversationInput = SendMessageInput & { projectId: string; model?: ModelRef; thinkingLevel?: ThinkingLevel }
RetryInput = { requestId: string }
```
- `view.ts` re-exports `AgentState` (for `view.docs["pi.agent"]`).
- `RouteDef` gains an optional `bodyLimit`.

### Core
```ts
settings: {
  get(): Promise<Settings>;
  setDefaultModel(ref: ModelRef): Promise<void>;
  setFastModel(ref: ModelRef | null): Promise<void>;     // invalid_request for an unlisted model
  setProjectsFolder(path: string): Promise<void>;        // absolute; mkdir -p; stores realpath; not_a_directory
};
projects: {
  list(): Promise<Project[]>;                            // Home first, then creation order
  add(input: { path: string; name?: string }): Promise<Project>;
  clone(input: { url: string; name?: string }): Promise<Project>;  // resolves with status "cloning"
  retryClone(id: string): Promise<void>;                 // invalid_request unless "failed"
  rename(id: string, name: string): Promise<void>;       // invalid_request for "home"
  remove(id: string): Promise<void>;                     // invalid_request for "home"
};
conversations: {
  list(projectId: string): Promise<ConversationSummary[]>;          // archived included, deleted excluded
  listAll(): Promise<ConversationSummary[]>;                        // every project incl. Home, most recent first
  start(input: StartConversationInput): Promise<ConversationSummary>;  // replaces create()
  rename(id: string, title: string): Promise<void>;
  send(id: string, input: SendMessageInput): Promise<void>;
  abort(id: string): Promise<void>;
  archive(id: string, archived: boolean): Promise<void>;            // not_found
  remove(id: string): Promise<void>;                                // idempotent
  retry(id: string, input: RetryInput): Promise<void>;              // invalid_request unless retryable; once per requestId
  watch(id: string, onOps: OpsListener): Promise<ConversationWatcher>;  // gets [["r", null]] when the thread is deleted
};
```

### Errors
New codes and HTTP statuses: `images_not_supported` 422, `invalid_git_url` 422, `too_large` 413 (also Fastify's `FST_ERR_CTP_BODY_TOO_LARGE`), `project_not_ready` 409, `git_missing` 409.

### REST
- `GET /conversations` → `listAll`. `POST /conversations` (201, summary) → `start`, replaces `POST /projects/:id/conversations`.
- `PUT /conversations/:id/archived` `{ archived }` (204). `DELETE /conversations/:id` (204). `POST /conversations/:id/retry` `{ requestId }` (204).
- `POST /projects/clone` (201, project). `POST /projects/:id/retry-clone` (204).
- `PUT /settings/fast-model` `{ model: ModelRef | null }` (204). `PUT /settings/projects-folder` `{ path }` (204).
- `bodyLimit` 42 MiB on `POST /conversations` and `POST /conversations/:id/messages`; Fastify default elsewhere.

## Core

### Files (Phase 0 splits them so A1 and A2 never edit the same file)
- `harness/app-docs.ts` → `harness/conversation-docs.ts` (`app.conversation`, `app.project-index`) and `harness/projects-doc.ts` (`app.projects`).
- `create-core.ts` is pre-wired in Phase 0 with every new module (stubs), so no Phase 1 agent edits it.
- `harness/open.ts`: `openAgentHarness` gains `beforeResume?: (harness: Harness) => void | Promise<void>`, awaited before `resume()` (the status listener subscribes there). The fixture recorder uses the same signature.
- Phase 0 also does the `toModelInfo` change in `provider/provider-service.ts` (`images`, `thinkingLevels`) and freezes `ConversationStore.removeAllOfProject(projectId)` (A1 implements: tombstone + abort + retire watchers). `projects-api.remove` calls it; `project-store.remove` only drops the project record and no longer empties the index.
- Startup order, fixed in `create-core.ts`; each module exposes `recoverAtStartup()`: (1) status listener in `beforeResume`, (2) `resume`, (3) clone recovery (A2), (4) abort tombstoned live runs (A1), (5) `pendingStart` re-submits (A1).

### Migrations
- `settings.json`: parse as a partial and merge over defaults (an MVP file `{ defaultModel }` keeps its model). `projectsFolder` resolved at read time, stored only when set.
- `app.projects` v2: `migrate` fills `kind: "folder"`, `status: "ready"`.
- `app.conversation` v2: adds `titleSource: "first-message" | "generated" | "user"` (migrate: `"user"` if the title is non-empty, else `"first-message"`), `pendingFirstInput?`, `deletedAt?`.
- `app.project-index`: no version bump. New optional entry fields `startRequestId`, `pendingStart`, `archivedAt`, `deletedAt`, `status`, `lastRunEndedAt`; `toSummary` fills defaults (`null`, `"idle"`).

### Home project
- `ProjectStore.find/require/list` include the synthetic Home `{ id: "home", kind: "home", name: "Home", path: os.homedir(), status: "ready", createdAt: 0 }` in one place; callers do not special-case it. Not stored in `app.projects`; its index `app.project-index["home"]` works like any other.

### Start a conversation (`conversations.start`)
1. Validate first, so a rejection never leaves a thread:
   - project exists and is `ready` (`project_not_ready`);
   - provider configured (`no_provider`); model = `input.model ?? settings.defaultModel` (`no_default_model` only when neither); the model exists via the sync `models.getModel(provider, id)` (`invalid_request`), no network call;
   - text or images (`invalid_request`); images allowed by the chosen model (`images_not_supported`); image bytes match `mimeType` (magic bytes, `invalid_request`).
   - thinking level = `clampThinkingLevel(model, input.thinkingLevel ?? "medium")` (pi-ai).
2. Coalesce in process: a `Map<requestId, Promise>` returns the same promise for a concurrent duplicate.
3. `createConversation({ ownership, agent: { model, cwd: project.path, thinkingLevel }, init })`. `init` reads `app.project-index[projectId]`; if an entry already has this `startRequestId`, throw a private `ExistingStart(conversationId)` (rolls back). Otherwise write `app.conversation` (`projectId`, provisional title, `titleSource: "first-message"`, `pendingFirstInput: { text, images, requestId }`) and the index entry (`startRequestId`, `pendingStart: true`, `status: "running"`), in the same commit.
4. `send` with the same `requestId` (exactly once through `submissionByRequest`); then one commit clears `pendingFirstInput` and `pendingStart` and does the title/touch update.
5. On `ExistingStart`: re-send (idempotent) and return the existing summary.
6. At startup: for index entries with `pendingStart` and no `deletedAt`, re-submit `pendingFirstInput` with its `requestId`, then clear.
- `start` resolves after the message is admitted, so the first `[["r", view]]` already contains it.

### Images
- `send` maps input to Pi `UserInput`: no images → the string; with images → `[{ type: "text", text }` only when `text.trim() !== ""`, `...images.map(i => ({ type: "image", ...i }))]`.
- Before submit, the thread's model (`pi.agent` → `models.getModel(...).input`) must accept images (`images_not_supported`). Same validation as `start` for text/images/magic bytes.

### Titles (`core/src/titles/`)
- Provisional title on the first message: `titleFromFirstMessage(text)`, or `"Image"` for an image-only message. Also for legacy empty MVP threads on their first `send`.
- Then a best-effort job when the message has text, with `fastModel ?? the thread's model`:
  ```ts
  provider.models.completeSimple(
    provider.models.getModel(ref.provider, ref.modelId),
    { systemPrompt: TITLE_PROMPT, messages: [{ role: "user", content: text.slice(0, 4000), timestamp: now }] },
    { signal: AbortSignal.timeout(15_000) },
  );
  ```
  - `TITLE_PROMPT`: "Write a 3–8 word title for this coding request. Under 40 characters. Do not copy and truncate the request. Output only the title."
  - `stopReason` `"error"`/`"aborted"` is a failure. Join text blocks only, first line, strip quotes and a leading `Title:`, cap at 80 characters (shared helper with `titleFromFirstMessage`); an empty result is a failure.
  - The commit reads `app.conversation` inside the commit; writes only when `titleSource === "first-message"` and not `deletedAt`; sets `"generated"`. `rename` sets `"user"`. Emits `{ resource: "conversations", projectId }`.
  - Failures are logged and ignored; the provisional title stays. Not resumed after a restart.
- `ProviderService.models` is passed in; never the free pi-ai functions (they bypass our credential store).

### Thread status (`core/src/status/`; Pi imports only through `harness/`)
- Source: `harness.subscribeCommits` (sync, must not block or call Session APIs). `pi.live.run` is present exactly while a thread is busy.
1. In memory: `Map<ConversationId, { busy, runEnded }>`. The listener does not filter by id.
2. Listener: for each `"document"` change with `record.kind === "pi.live"`, `busy = value?.run !== undefined`; when it differs from the map, record it, set `runEnded = true` on busy → idle, and `queueMicrotask` a flush.
3. Flush, on a serial queue outside the listener, using the current in-memory state (coalesces fast run → idle → run):
   - Inside its commit, read `app.conversation` for the project id; skip when absent (subagent children) or `deletedAt`.
   - busy → `status: "running"`; idle → last `pi.assistant` in the context with `stopReason: "error"` → `"error"`, else `"idle"`.
   - Write the index entry when the status differs or `runEnded` is set (`runEnded` sets `lastRunEndedAt = now`, then clears). At most two index commits per run. Then emit `changed`. App-doc commits do not loop back (they are not `pi.live`).
4. Subscribed in `beforeResume`, before `harness.resume()`.
5. Startup: entries stored as `running` are checked against `harness.snapshot(LiveDoc, id)`; no run → flush.

### Archive
- `archive(id, archived)`: sets/clears `archivedAt` on the index entry. Never aborts. `send`/`retry` on an archived thread clear it.

### Delete (tombstone)
- `remove(id)`: one commit sets `deletedAt` on `app.conversation` and the index entry; then abort; then every active watcher of that id gets `[["r", null]]` and stops (`conversation-store` keeps watchers per id).
- Not `retireDoc`: `tx.doc()` would recreate the document and resurrect the thread.
- `known()`, `list`, `listAll`, the title job, the `pendingStart` scan, status flushes, archive and every other writer treat `deletedAt` as `not_found` / skip; each writer reads `app.conversation` inside its commit and returns if `deletedAt` is set.
- Startup: tombstoned threads whose `pi.live.run` exists are aborted (crash between tombstone and abort).
- Project `remove` tombstones all its threads the same way.

### Retry
- Retryable when idle and the last entry of kind `pi.user` | `app.retry` | `pi.assistant` | `pi.tool-result` is NOT a `pi.assistant` with `stopReason` `"stop"` or `"length"` (covers errors, aborts, a stop during a tool, and an abort before the first token). One pure function `isRetryable(view: ConversationView)` in `protocol` (Phase 0), used by A1 and D.
- Pi's `ConversationBusy` (from `whenBusy: "reject"`) maps to `invalid_request`.
- `retry(id, { requestId })`: one submission, `submit({ type: "input", content: RETRY_PROMPT, entry: { kind: "app.retry" }, requestId, whenBusy: "reject" })`, `RETRY_PROMPT = "The previous attempt failed or was stopped. Continue."`. Exactly once per `requestId`; no duplicate user message or images; correct after partial tool work (Pi already drops error/aborted assistant messages from the model context).
- Clears `archivedAt`.

### All threads
- `listAll()`: reads the index of each `projects.list()` entry (Home included once), excludes deleted, most recent first.
- `remove(id)`: an unknown id → `not_found`; an already-deleted id resolves.

### Git clone (`core/src/git/`)
- `clone({ url, name })`:
  1. `git --version` must work (`git_missing`).
  2. Allowlist: `https://host/…`, `ssh://[user@]host[:port]/…`, `user@host:path`. Host and user match `[A-Za-z0-9._-]+` and do not start with `-`; no `::` anywhere; no password in the userinfo. Else `invalid_git_url`.
  3. Normalize for duplicates: lowercase host, scp form → `ssh://`, strip a trailing `/` and `.git`. Same normalized URL → `duplicate_project`.
  4. Folder name: last path segment without `.git`, sanitized to `[A-Za-z0-9._-]`, not starting with `.` or `-`, fallback `repo`. Claim `<projectsFolder>/<name>` with a non-recursive `mkdir` (EEXIST → `-2`, `-3` …).
  5. Store the project (`status: "cloning"`, `path` = claimed folder), return it, clone in the background.
- Process: `spawn("git", ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always", "clone", "--no-recurse-submodules", "--", url, dir], { detached: true, stdio: ["ignore", "ignore", "pipe"], env })`; keep the last 4 KB of stderr. Env: the user's env plus `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `SSH_ASKPASS_REQUIRE=never` (the user's `GIT_SSH_COMMAND` stays). `detached` gives no controlling tty, so ssh cannot prompt. Timeout 10 minutes; on timeout or `remove`, `process.kill(-pid)` kills the group.
- Success: `status: "ready"`, `path` = realpath. Failure: `status: "failed"`, `error` = last stderr line; delete exactly the claimed folder (only ever a recorded direct child of `projectsFolder`). If the project was removed meanwhile, the completion commit is a no-op and the folder is deleted.
- Startup: every `"cloning"` project becomes `"failed"` ("Interrupted by a restart") and its claimed folder is deleted, so `retryClone` reuses the path.
- Tests and faux mode: `protocol.file.allow=always` and local paths only through an injected `allowFileClones`, read from `deps.env.TAU_ALLOW_FILE_CLONES === "1"` and honored only with `faux: true`.

## Server

- New routes, `bodyLimit` from `RouteDef`, `FST_ERR_CTP_BODY_TOO_LARGE` → `too_large`, new status codes. No business logic. Fastify `inject` tests against the fake for every new route and error code.

## Web

### Design system (Phase 0, before features)
`Combobox` (Popover + Command, searchable, groups, disabled items with a hint), `Tabs`, `Label`/`Field`, `Spinner`, `Alert`, `ImageThumbnail` (preview with remove button), `DropZone` (drag-and-drop overlay), `StatusDot` (running/error/unseen), `CopyButton`, `Switch`. All on theme tokens.

### Frozen in Phase 0
- `conversation/index.ts` exports `Composer` and:
  ```ts
  export interface ComposerProps {
    target: "new" | string;          // draft key
    imagesAllowed: boolean;
    busy?: boolean;
    footer?: ReactNode;              // C puts the project/model/thinking pickers here
    onSend(input: { text: string; images: ImageInput[] }): Promise<void>;
    onStop?(): Promise<void>;
    onSent?(): void;
  }
  ```
- `lib/paths.ts`: `newThreadPath(projectId?)`, `conversationPath(projectId, id)`.
- `lib/queries.ts`: `useAllConversations` (key `["conversations", "all"]`), `ModelInfo` fields.
- `lib/use-changed-invalidation.ts`: a `conversations` change also invalidates `["conversations", "all"]`.
- `lib/preferences.ts`: typed localStorage helpers (try/catch) for last project, last model/thinking, notifications, `lastSeenAt`.
- `lib/hotkeys.ts`: `useHotkey(combo, handler)`; in text inputs it ignores only combos without `Mod` (`Mod+*` always fires); calls `preventDefault` (`Mod+Shift+O` is also a browser shortcut).
- `lib/preferences.ts` also stores a `seenBaseline` (set on first load), used when a thread has no `lastSeenAt`, so a fresh browser does not mark every thread unseen.
- `routes/MainLayout.tsx` mounts placeholder `<CommandPalette/>`, `<GlobalShortcuts/>`, `<NotificationWatcher/>`, `<MarkSeenWhileOpen/>` from E's folders; `setup/SettingsDialog.tsx` renders a placeholder `<NotificationSettings/>` from `notifications/`.
- `api.ts` methods for every new route.

### Routes
- `/` → new thread page (after setup). `/new?project=<id>` preselects a project. `/p/:projectId/c/:conversationId` unchanged.

### New thread page and settings (C)
- Centered `Composer` (`target: "new"`); its `footer` holds the project, model and thinking `Combobox`es. Project: Home, then projects; cloning/failed ones disabled with their state. Thinking: only `ModelInfo.thinkingLevels`, hidden when only `"off"`. Defaults from `preferences`.
- `imagesAllowed` from the chosen model's `ModelInfo.images`.
- Send → `POST /conversations` with a `requestId` kept per draft in sessionStorage (reused on retry, cleared on success) → navigate to the thread. While pending, the composer is busy; no optimistic message.
- `SettingsDialog`: fast model ("Same as thread" = null), projects folder (with the data-home warning).
- Setup `ModelStep`: an optional fast-model picker in the same submit as the default model.

### Composer and thread view (D)
- Composer: text, attach button, paste, drop on the whole page (`DropZone`), `ImageThumbnail` row, Enter sends, `Esc` stops a running thread when the composer has focus.
- Client-side resize before upload, always: longest side ≤ 2048 px; re-encode to WebP (JPEG fallback) when larger than 1.5 MB; GIF kept as is if its base64 fits 5 MiB, else a toast. Compress before checking limits.
- `UserMessage` and `QueuedMessages` render image blocks as thumbnails; click opens a `Dialog`.
- Header: title, model and thinking level (`view.docs["pi.agent"].thinkingLevel ?? "off"`).
- `CopyButton` on every user and assistant message (Markdown text) and on code blocks.
- Retry button under the last answer when the view matches the core retry rule; `app.retry` entries render as a small "Retried" divider.
- `imagesAllowed` in a thread: `pi.agent` model looked up in `useModels()`; unknown → allowed (core enforces).
- A `[["r", null]]` (deleted) shows "This thread was deleted" with a link to `/`.

### Navigation (E)
- Sidebar: Home group first; per project a "New thread" action; cloning project → `Spinner`, failed → error badge with Retry and Remove; add-project dialog with `Tabs` "Folder" / "Git URL" (URL, optional name, shows the target folder).
- Rows: `StatusDot` (running, error, unseen = `lastRunEndedAt > lastSeenAt` and not open); row actions in a `DropdownMenu` always reachable by touch (rename, archive/unarchive, delete); "Archived" collapsed group per project; delete confirm `Dialog`; deleting the open thread navigates to `/`.
- `activity/`: `MarkSeenWhileOpen` updates `lastSeenAt` for the open thread from the route (D not involved).
- `notifications/`: settings `Switch` asks permission on click; the watcher reads `useAllConversations` and fires when a summary's `lastRunEndedAt` grows compared with the previous data (never on first load), skipped when that thread is open and visible; `new Notification(title, { tag: conversationId })` so tabs dedupe; click focuses and opens the thread.
- `palette/`: `Mod+K` `CommandDialog` over `useAllConversations` and projects, client-side filter; actions New thread, Settings. `GlobalShortcuts`: `Mod+Shift+O`.

## Testing

- Faux (Phase 0, integrator, `core/src/testing/**`): seed the faux queue with ~8 steps (a title job and a run stream at once); `faux-fast` returns exactly `Title: <first 3 words>` (branch on `model.id`); `faux-text` with `input: ["text"]`; `faux-2` (second chat model); `image` command (replies with the number of images).
- Fixtures: an image message; `fail` → retry.
- Contract suite (fake and real), with a `waitForSummary(predicate)` helper for async status:
  - start: exactly once with a repeated and a concurrent `requestId`; a rejected start creates no thread; image-only input; `model: faux-2`; unlisted model → `invalid_request`; thinking level clamped; `images_not_supported` against the chosen model (`faux-text`).
  - titles: generated; not over a user rename.
  - Home: cannot be renamed, removed or added again. listAll across Home and projects.
  - status: idle → running → idle; `error` after `fail`; `lastRunEndedAt` set.
  - archive / unarchive on send. remove → `not_found` for send, watch, rename, retry; listAll excludes it; idempotent.
  - retry after `fail` answers; retry after a fine answer → `invalid_request`; a repeated retry `requestId` runs once.
  - clone lifecycle (cloning → ready / failed, retry); settings fast model and projects folder.
- Core: MVP settings file and v1 documents migrate; `pendingStart` re-submitted after a restart; ≤ 2 index commits per run during a long streamed reply; status listener before resume and `running` recomputed after restart; delete races (title job after delete, archive after delete, tombstoned live run aborted at startup); a watch gets `[["r", null]]` on delete; retry after abort before the first token and after partial tool work; clone against a local bare repo; rejected URLs (`-x`, `ext::…`, `a::b`, `/..`, password); kill on remove; startup clone cleanup; title job success, failure and timeout.
- Fake core: status timers, listAll, archive, remove, retry, clone timers.
- Server: every new route; body too large → 413 `too_large`.
- Web: new thread page and pickers (only supported levels); project default and fallback; composer attach/paste/drop/resize; images in transcript and queue; header; copy buttons; retry visibility; deleted view; unseen logic; notification on `lastRunEndedAt`, deduped by tag; palette filter and navigation; shortcuts; archived group; delete confirm navigation; settings dialog; add-project tabs; clone states.
- e2e (faux; `HOME`, `GIT_AUTHOR_*`/`GIT_COMMITTER_*` set to temp values; `TAU_ALLOW_FILE_CLONES=1`): new thread page → Home → `write hello.txt hi` → file in the temp home → generated title and status dot running → idle; clone a local bare repo → start a thread in it; send an image → reply counts 1; `fail` → Retry → answer; archive and delete.

## Parallel work

Same rules as the MVP (`AGENTS.md`); update its ownership line for the six owners below.

### Phase 0: contract, design system, faux, stubs (1 agent, integrator)
1. Protocol: entities, `Core` interface, REST schemas with `bodyLimit`, error codes and statuses, `ThinkingLevel`, `AgentState` re-export.
2. Core: split `app-docs.ts`; `beforeResume` in `openAgentHarness`; pre-wire `create-core.ts` with stub modules; faux models and commands; re-record fixtures.
3. Testkit: fake `Core` for every new method; catalog `images`/`thinkingLevels`; contract suite cases.
4. Web: design system components; everything under "Frozen in Phase 0"; placeholder `Composer`.
5. Stubs throw `internal` "not implemented"; web placeholders render.
6. Update the `AGENTS.md` ownership line for the six owners.
7. Done when check, test (contract suite green against the fake) and build pass.

### Phase 1: parallel (6 agents)
- **A1 — core conversations**: `conversations-api.ts`, `conversation-title.ts`, `harness/conversation-store.ts`, `harness/conversation-docs.ts`, `titles/**`, `status/**`: start, images, titles, status, archive, delete, retry, listAll, conversation migrations.
- **A2 — core projects, settings, git**: `projects-api.ts`, `harness/project-store.ts`, `harness/projects-doc.ts`, `home/settings-store.ts`, `settings-api.ts`, `provider/**`, `git/**`, `resolve-project-folder.ts`: Home, clone, settings and their migrations.
- **B — server + CLI**: routes, body limits, error mapping.
- **C — web shell**: `app/`, `routes/`, `setup/`, `lib/` except `api.ts`, `transport/` and the frozen files: new thread page, pickers, settings.
- **D — web conversation**: `conversation/**`: composer, images, header, copy, retry, deleted view, `Esc`.
- **E — web navigation**: `sidebar/**`, `palette/**`, `notifications/**`, `activity/**`.
- Done for each: contract suite (core) or own tests green; `VITE_FAKE=1` shows the feature.

### Phase 2: integration (1 agent)
- Apply `CONTRACT-CHANGES.md`, e2e, real run with OpenRouter (Haiku 5.5 as default and fast model), README update.

## Decisions from review round 1
1. The first input cannot be admitted in `init` (`Tx` has no admission); `start` stores `pendingFirstInput` and re-submits at startup, with in-commit duplicate detection.
2. The composer reads the thread's model from the view (`pi.agent`), not from `ConversationSummary`.
3. Titles go through `ProviderService.models` (our credentials), and fall back to the thread's model.
4. Settings and app documents migrate; clone runs detached with a protocol allowlist and strict URL and folder rules.
5. Base64 images in JSON, 5 MiB base64 per image.

## Decisions from review round 2
1. Thread status comes from `subscribeCommits` on `pi.live.run` transitions, written to the index only on change.
2. Retry is one `app.retry` input, not a re-send of the last message.
3. Delete is a tombstone, not `retireDoc`; open watches get a retired view.
4. Six Phase 1 owners (core split in two, web navigation separate); Phase 0 freezes shared web files.
5. Thinking level defaults to `"medium"`, clamped; the body limit is 42 MiB.

## Decisions from review round 3
1. The status listener tracks every `pi.live` change and a `runEnded` flag, so no transition or `lastRunEndedAt` is lost; `beforeResume` is async.
2. One shared `isRetryable(view)` in protocol, which also covers a stop during a tool.
3. Project removal tombstones threads through A1's `removeAllOfProject`; startup order is fixed in `create-core.ts`.
4. `Mod+*` shortcuts fire inside text inputs.
