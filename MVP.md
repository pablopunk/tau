# MVP plan

Status: APPROVED v4 (after 3 review rounds). Product context and long-term decisions: [PLAN.md](PLAN.md).

## Goal

End to end, smallest scope, production quality:

> Install → connect OpenRouter → add a project folder → chat with an agent that reads, edits and runs commands in that folder.

This is the start of the real product, not a proof of concept. Small scope, but every part is built to last. The work is split so several agents can build it in parallel in this repo.

## Scope

In:
- `npx <name>` starts one Node process on `127.0.0.1` and opens the browser.
- Setup: OpenRouter API key (validated), then a default model from the models that key can use.
- Projects: add by absolute folder path, rename, remove (removing never touches the folder).
- Conversations: per project, create, list, rename; title defaults to the start of the first message.
- Chat: user messages, streamed assistant text, thinking (collapsed), tool calls with arguments and output (edit as a diff, bash with exit code), model errors and retries, queued messages; send (steers while busy), stop.
- Persistence: everything survives a restart; an unfinished run resumes.
- Live everywhere: two tabs on the same conversation or sidebar stay in sync.

Out (later, see PLAN.md): remote access, pairing, tunnels, remote runtimes, terminals, git/worktrees, other providers, fast/image/voice models, model per conversation, per-project settings, usage/cost display, extensions beyond coding tools, Claude Code compatibility, PWA install.

## Stack

- Node ≥ 22.19 (Pi's minimum), TypeScript strict, ESM only.
- pnpm workspace through mise (like webr). Biome for lint + format, with `useImportType` enforced. Vitest. Playwright for e2e.
- Agent: `@earendil-works/pi-durable`, `@earendil-works/pi-ai`, `@earendil-works/chord`, all pinned to exactly `1.3.0` (experimental API).
- Server: Fastify 5 + `@fastify/websocket` + `@fastify/static` + TypeBox type provider (like webr).
- Web: React 19 + Vite, Tailwind v4, shadcn/ui (components in `packages/web/src/components/ui`), our theme tokens in one CSS file, light + dark. TanStack Query for REST.
- Schemas: TypeBox for every REST body and WebSocket frame envelope, validated on both sides.
- Build: tsdown for the CLI bundle.

## Architecture

```text
browser (packages/web)
   │  HTTP /api (REST, JSON)  +  one WebSocket /api/live
   ▼
server (packages/server)  ── translates HTTP/WS ⇄ Core calls; security; static files. No business logic.
   ▼
core (packages/core)      ── the app: settings, credentials, provider, projects, conversations
   ▼
Pi Durable Harness (SQLite) + pi-ai Models (OpenRouter) + NodeExecutionEnv(cwd = project path)
```

Package rules:
- `protocol` is the only package `web` and `server` share. It re-exports Pi view types with `import type` only, so `web` never bundles Pi code. The only Pi runtime code in `web` is `@earendil-works/chord/delta` (`applyImmutable`; it only imports `../json.ts`, browser safe).
- `core` never imports `server`, Fastify or `ws`. The `Core` interface and its types live in `protocol` (`protocol/src/core.ts`); `core` implements it and `server` depends only on it.
- Dependency graph is one-way: `protocol` (no internal deps) ← `testkit` ← dev dep of `core`, `server`, `web`; `core`, `server`, `web` depend on `protocol`; `cli` depends on `core`, `server` and the built `web`.
- Only `core/src/harness/` imports `@earendil-works/pi-durable`. API churn stays there. Every Pi call needs a Chord `Context`; `core` hides it (`BACKGROUND_CONTEXT` or a per-request one).

### Data home

`~/.tau/` (override with `--home` / `TAU_HOME`), directory mode 0700:
- `agent.sqlite`: Pi Durable storage. Holds conversations and our app documents (below).
- `settings.json`: `{ defaultModel }` (0600).
- `credentials.json`: provider credentials (0600), through our `FileCredentialStore`.
- `lock`: one process per home (Pi does no cross-process locking). A second launch prints the running URL and exits.
- All file writes go to a temp file, then rename.

### App documents (in Pi Durable, no separate database)

- `app.projects` (session scope): `{ projects: [{ id, name, path, createdAt }] }`.
- `app.project-index` (session scope, keyed by projectId): `{ conversations: [{ conversationId, title, createdAt, updatedAt }] }`.
- `app.conversation` (conversation scope): `{ projectId, title }`.
- A conversation is created with `harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model, cwd }, init: (tx, conversationId) => … }, context)`; `init` writes `app.conversation` and the index entry **in the same commit** as the conversation (verified: `durable/src/harness/harness.ts:357-372`), so they never disagree. The index exists because `scanConversations` cannot filter by project and also returns subagent children.
- `app.project-index` is a document family: `tx.doc(token, projectId, seed)` needs a seed. Documents cannot be deleted, so removing a project empties its index document.
- Core is the only writer of `app.*` documents, so `onChange` fires after core's own successful commits (project add/rename/remove, conversation create/rename, title set on first send, `updatedAt` on send). Not `watchDoc` (it does not create documents and watches one key at a time). If other writers ever appear: `harness.subscribeCommits()`.

### Core

The interface below lives in `protocol/src/core.ts` (with `Settings`, `ProviderStatus`, `Project`, `ConversationSummary`, `Change`, `ModelRef`, `ModelInfo`; `Op` via `import type`). `createCore` lives in `core`.

```ts
function createCore(options: { home: string; faux?: boolean }): Promise<Core>;

interface Core {
  settings: { get(): Promise<Settings>; setDefaultModel(ref: ModelRef): Promise<void> };
  provider: {
    status(): Promise<ProviderStatus>;          // configured?, source: "file" | "env", valid?
    setApiKey(key: string): Promise<void>;      // validates with GET https://openrouter.ai/api/v1/key first
    listModels(): Promise<ModelInfo[]>;         // personalizeOpenRouterCatalog(models.getModels("openrouter"), …)
  };
  projects: {
    list(): Promise<Project[]>;
    add(input: { path: string; name?: string }): Promise<Project>;   // realpath, must be an existing directory, no duplicates
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;          // aborts its busy conversations first
  };
  conversations: {
    list(projectId: string): Promise<ConversationSummary[]>;
    create(projectId: string): Promise<ConversationSummary>;        // uses the current default model
    rename(id: string, title: string): Promise<void>;
    send(id: string, input: { text: string; requestId: string }): Promise<void>;  // steers when busy
    abort(id: string): Promise<void>;
    watch(id: string, onOps: (ops: readonly Op[]) => Promise<void>): Promise<{ stop(): Promise<void> }>;
  };
  onChange(listener: (change: Change) => void): () => void;         // projects / conversation index changed
  close(): Promise<void>;
}
```

Harness setup (verified against Pi source, commit 95364a5; re-verified against installed 1.3.0 in Phase 0):
- `Harness.open(await openNodeSqliteStorage(agentDb), { models, registry, settings, env }, context)`.
- Registry: `CodingTools` + our `coding` extension (preamble section, `cwd` section, project `AGENTS.md` section). Installed before `harness.resume()`, every start.
- `env: ({ cwd }) => new NodeExecutionEnv({ cwd })`.
- Models: `createModels({ credentials: new FileCredentialStore(path) })` + `setProvider(openrouterProvider())`. pi-ai only ships `InMemoryCredentialStore`; ours is ~60 lines (a promise chain per provider for serialized writes, temp file + rename, 0600). `envApiKeyAuth` falls back to `OPENROUTER_API_KEY`; `status()` reports the source.
- The OpenRouter provider uses a static catalog bundled in pi-ai (no `refreshModels`). `personalizeOpenRouterCatalog` filters it to the models the key can use. It returns the full catalog on a 401, so key validation is a separate call.
- There is no harness-wide default model: the model is fixed in `pi.agent` at creation. Changing the default only affects new conversations; the settings UI says so.
- `watch()`: `conversation.watch()`; first call the listener with `[["r", watch.value]]`, then `start()` forwards each commit's `Op[]`. A slow watch later sends `[["r", view]]` again (Pi keeps at most 100 pending frames), and a retired view arrives as `[["r", null]]`.
- Lifecycle: `harness.closed` ending with `failed` → log and exit non-zero. SIGINT/SIGTERM → `core.close()`.
- One harness factory, `openAgentHarness({ storage, models, registry, env })` in `core/src/harness/open.ts`, used by both the real core and the fixture recorder.
- Faux mode (`faux: true`, `TAU_FAUX=1`): pi-ai's faux provider with our `faux-script` (see Testing) instead of OpenRouter. Setup is **not** skipped: any key is accepted and the faux models are listed, so e2e covers setup too.

### Protocol (`packages/protocol`)

- REST under `/api`:
  - `GET /settings`, `PUT /settings/default-model`
  - `GET /provider`, `PUT /provider/key`, `GET /models`
  - `GET /projects`, `POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id`
  - `GET /projects/:id/conversations`, `POST /projects/:id/conversations`
  - `PATCH /conversations/:id`, `POST /conversations/:id/messages`, `POST /conversations/:id/abort`
- Errors: `{ error: { code, message } }`; codes are a closed union in `protocol` (`invalid_key`, `path_not_found`, `not_a_directory`, `duplicate_project`, `not_found`, `no_provider`, `no_default_model`, `invalid_request`, `unauthorized`, `internal`).
- WebSocket `/api/live`:
  - client → server: `{ type: "subscribe" | "unsubscribe", conversationId }`.
  - server → client: `{ type: "ops", conversationId, ops: Op[] }` (the first frame after subscribe is `[["r", view]]`), and `{ type: "changed", resource: "projects" | "conversations", projectId? }` (client invalidates its queries).
  - Only frame envelopes are validated with TypeBox; `applyImmutable` checks every op.
  - Reconnect: resubscribe, get a fresh base.
- Types: re-export `ConversationView`, live/inbox state and tool `details` types from Pi with `import type`; no hand-written copy of the view.

### Security (localhost is not safe by default)

Any web page can reach `127.0.0.1`, and the agent has `bash`. So, in the server, from Phase 1:
- Accept only `Host` = `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding).
- Check `Origin` exactly (scheme, host and port) on the WebSocket upgrade and on every non-GET request. SameSite alone is not enough: `127.0.0.1:3000` (e.g. a dev server the agent starts) is the same site.
- Require `Content-Type: application/json` on bodies.
- A random token stored in `<home>/token` (0600), kept across restarts so open tabs keep working: the CLI opens `http://127.0.0.1:<port>/?token=…`; the server swaps it for an HttpOnly, SameSite=Strict cookie named `tau_<port>` (cookies are not scoped by port) and redirects to `/`; every `/api` request and the WebSocket need the cookie. The CLI prints the URL with the token; a second launch reads the token and prints the same URL.
- A request without the cookie gets a plain page saying "open the URL printed in your terminal", not a bare 401.

### Web (`packages/web`)

- Screens: `Setup` (key → model) until provider and default model are set; `Main` with sidebar (projects → conversations, add project, new chat, rename, remove) and the conversation view.
- Routing: `/p/:projectId/c/:conversationId`.
- Conversation view, rendered purely from the view:
  - transcript from `entries` (`pi.user`, `pi.assistant`, `pi.tool-result`, `pi.system` hidden);
  - streaming answer and running tools from `docs["pi.live"]`, retries from `pi.live.generation.retry`;
  - model errors from `pi.assistant` entries with `stopReason: "error"`;
  - queued messages from `docs["pi.inbox"]`;
  - composer: Enter sends, Shift+Enter newline, sends steer while busy; stop button while busy.
- Tool renderers: `read`, `write`, `edit` (from `details.diff`/`patch`), `bash` (from `{ output, exitCode, truncated }`), and a generic fallback.
- Data: TanStack Query for REST, invalidated by `changed` frames. `LiveClient` (one WebSocket, reconnect with backoff) keeps one view per subscribed conversation with `applyImmutable`. Its interface is frozen in Phase 0 (`web/src/conversation/index.ts`): `subscribe(conversationId, onView) → unsubscribe`, `onChanged(cb) → unsubscribe`, `status`. C uses only `onChanged`; D implements it.
- `web/src/lib/api.ts` has a swappable transport: real (`fetch` + WebSocket) or, with `VITE_FAKE=1`, the in-browser fake from `@tau/testkit` (REST and live frames), loaded with a dynamic `import()` behind `import.meta.env.VITE_FAKE` so it never reaches the production bundle (a CI check greps `web/dist` for fixture strings). C and D develop with it from day one, without waiting for B.
- Responsive from day one: the sidebar becomes a sheet on small screens.

### CLI (`packages/cli`)

- `bin` → `createCore({ home })` → `createServer({ core, staticDir, port })` → print URL → open browser. Flags: `--port` (default 4317, next free if taken), `--no-open`, `--home`.
- One published npm package: workspace packages are private and bundled by tsdown; Pi packages stay external runtime dependencies (they use `node:sqlite` and WebAssembly); `web/dist` is copied in.

## Testing

- `core/src/testing/faux-script.ts`: a faux response function that reads the last user message as a tiny script: `write <path> <text>`, `bash <cmd>`, `read <path>`, `think`, `fail`; anything else is a slow streamed reply. Used by tests, fixtures, e2e and faux mode.
- Fixture recorder (`pnpm fixtures`, in `core`): runs the real Harness (through `openAgentHarness`) with the faux script and saves frame sequences to `packages/testkit/fixtures/*.json`: plain text, thinking, read/write/edit/bash, model error with retry, steer while busy (inbox), abort, and a long tool output that overflows the 100-frame watch buffer (a mid-stream `[["r", view]]` reset). Only the integrator re-records fixtures after Phase 0.
- `packages/testkit` (private, browser safe, no `node:` imports, exports TypeScript source so it needs no build step): the fixtures, a fake `Core` that replays them, and the contract suite `runCoreContract(name, makeCore)`. Testkit's own test runs it against the fake; core's test runs it against the real core. Dev dependency of `core`, `server` and `web`.
- The recorder writing into `packages/testkit/fixtures/` is a file write, not a package dependency. It is a manual `pnpm fixtures` script, not part of `build` or `test`.
- `core`: contract suite + Harness tests on a temp home (send → tool runs in the project folder → file changed; restart resumes; remove aborts).
- `server`: Vitest with Fastify `inject` against the fake: validation, error codes, security checks, WebSocket subscribe/ops/changed.
- `web`: Vitest + Testing Library: view rendering per fixture, tool renderers, composer, LiveClient reconnect, mid-stream reset, retired view (`[["r", null]]`).
- `e2e`: Playwright against the built CLI in faux mode: setup (key → model) → add project → chat `write hello.txt hi` → file exists on disk → reload page → transcript still there.
- Pi smoke test (`core/src/harness/pi-api.test.ts`): calls every Pi API we use against the installed version; fails loudly on a Pi upgrade that breaks us.
- CI (GitHub Actions): `pnpm check`, `pnpm test`, `pnpm build`, e2e.

## Parallel work

Rules for every agent (also in `AGENTS.md`):
- Phase 1 agents never edit `package.json`, `pnpm-lock.yaml`, `packages/protocol/**` (including the `Core` interface), `packages/testkit/**`, or files another workstream owns. `protocol` and `testkit` belong to the integrator. A needed contract change is a short note in `CONTRACT-CHANGES.md`; the integrator applies it.
- Each workstream commits only inside its own folders, small commits, tests green before each commit.

### Phase 0: foundation (1 agent, sequential)
1. Repo: pnpm workspace, mise, Biome, tsconfig base, Vitest, Playwright, tsdown, GitHub Actions, `AGENTS.md`.
2. Install **every** dependency for every package now (Fastify stack, Pi packages, React, TanStack Query, Tailwind, shadcn deps, testing libs).
3. `packages/web`: Vite + Tailwind v4 + shadcn initialized, theme tokens, and all shadcn components the MVP needs: button, input, textarea, dialog, sheet, dropdown-menu, popover, command, scroll-area, collapsible, tooltip, sonner, badge, skeleton, separator, sidebar.
4. `packages/protocol`: complete REST schemas, error codes, WebSocket frames, re-exported view types, and the `Core` interface with its types.
5. `packages/core`: `testing/faux-script.ts`, `harness/open.ts` (`openAgentHarness`: SQLite, CodingTools, faux provider — A builds on it), fixture recorder, Pi smoke test.
6. `packages/testkit`: recorded fixtures, browser-safe fake `Core`, `runCoreContract`; contract suite green against the fake.
7. Frozen signatures and stubs: `createCore` (stub), `createServer` (stub), `web/src/lib/api.ts` (typed client with real and fake transports), `web/src/conversation/index.ts` (`LiveClient` interface + `<Conversation id />` stub).
8. Done when CI passes: check, test (contract suite green against the fake), build; and `VITE_FAKE=1 pnpm --filter web dev` shows the app shell.

### Phase 1: parallel (4 agents)
- **A — core** (`packages/core/src/**` except `testing/**`): data home + lock, settings, `FileCredentialStore`, OpenRouter key validation and model list, app documents, projects, conversations, watch, `onChange`, lifecycle. Done: contract suite green against the real core, plus its own tests.
- **B — server + CLI** (`packages/server/**`, `packages/cli/**`): Fastify app, routes, security, WebSocket hub (backpressure: wait while `bufferedAmount` is high), static files with SPA fallback, CLI flags, port, lock message, browser open, tsdown bundle. Done: server tests green against the fake; `cli --faux` serves the built web app.
- **C — web shell** (`packages/web/src/{app,routes,setup,sidebar,lib}` except `lib/api.ts`): routing, Query client, `changed` invalidation, setup screen (key, validation errors, model combobox), sidebar, project and conversation dialogs, responsive layout. Develops with `VITE_FAKE=1`.
- **D — web conversation** (`packages/web/src/conversation/**`): `LiveClient` implementation, view rendering, tool renderers, error/retry/inbox states, composer, stop/steer. Develops with `VITE_FAKE=1` and the fixtures.

### Phase 2: integration (1 agent)
- Apply `CONTRACT-CHANGES.md`, wire the real core in the CLI, Playwright e2e in faux mode, one manual run with a real OpenRouter key (user validates), README with install and screenshots.

## Decisions from review round 1
1. App data lives in Pi Durable documents, not a separate `app.sqlite` (one store, one commit line).
2. The browser gets raw Chord ops (exact view, simple reconnect), not `watchEvents()`.
3. A fake `Core` alone is not enough: Phase 0 records real frame fixtures with a faux script, and a shared contract suite keeps the fake honest.
4. One published package; workspace packages bundled, Pi packages external.
5. Fastify instead of plain `http`; security on localhost from the start; `send` always steers while busy; no usage display.

## Decisions from review round 2
1. `packages/testkit`: browser-safe fake + fixtures, and a fake transport in the web app, so C and D never wait for B.
2. `LiveClient` interface frozen in Phase 0; C only listens to `changed`, D owns the socket.
3. `onChange` comes from core's own commits, not `watchDoc`.
4. Persistent token, port-named cookie, exact Origin check; faux mode keeps setup; fixtures cover buffer overflow and retired views.

## Decisions from review round 3
1. The `Core` interface moves to `protocol` and the contract suite to `testkit`, so the package graph has no cycle.
2. The fake is loaded only in fake mode (dynamic import), testkit exports source, and `protocol` + `testkit` are integrator-owned.
