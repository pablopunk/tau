# MVP11 plan: thread panes, starting with a terminal

Status: DRAFT v3 (review rounds 1 and 2 applied; round 3 pending). Builds on PLAN.md "Later → Thread panes" and "Built-in terminal".

## Goal

> In any thread I open a terminal next to the transcript. It is a real shell in the thread's folder (its worktree). It survives a page reload.

## Scope

In:
1. **Pane strip** in the thread view: the transcript plus open panes, side by side on desktop, tabs below 760 px. One pane kind now: `terminal`. The strip is generic (a pane has `kind` and `id`), so later kinds need no layout change.
2. **Terminal pane**: xterm.js in the browser, a PTY on the machine that runs tau, started by the `pi-env` daemon (`openTerminal`, `localDaemon()`). The shell is the user's login shell. Its folder is the thread's folder (worktree, or the project folder for a thread without one).
3. **Several terminals per thread**: open (button "Terminal" in the thread toolbar), close, switch. Each has a title (`zsh`, or the foreground job name from `foreground()`).
4. **Reload and reconnect keep the screen**: the hub keeps the last 256 KB of raw output per terminal and replays it on attach. Many browser tabs can attach to one terminal.
5. **URL**: the focused pane is in the URL, `/p/:projectId/c/:conversationId/terminal/:terminalId`. Back and forward work, a link reopens the same view (if the terminal is still running; else a "This terminal ended" state).
6. **Lifetime**: a terminal ends when its shell exits, when the user closes it, when the thread is archived or deleted, and when tau stops (the daemon kills it). Terminals do **not** survive a tau restart.

Out (later plans): agent tools that open, write to or read panes; other pane kinds (browser, file tree, editor, diff); a touch key bar for phones (the pane works on a phone but typing Esc/Ctrl needs the key bar, next plan); terminals on a remote runtime (the same `RemoteTerminal` API works over the bridge in PLAN.md); persistence across restarts; Windows (pi-env has no terminals there); setup steps that open a terminal with a typed command.

## Design

### Packages and owners' seams

- `protocol`: `TerminalInfo { id, conversationId, title, status: "running" | "exited", exitCode: number | null, createdAt }`, `Change` += `{ resource: "terminals", conversationId }`, REST routes (below), WS control frames (TypeBox), `TERMINAL_STREAM_PATH`.
- `core`: `Core.terminals { list(conversationId), open(conversationId, { cols, rows }), close(id), attach(id, { onData, onExit }) → { write, resize, detach } }`. Code in `core/src/terminals/**`. The **only** file that imports `@earendil-works/pi-env` is `core/src/harness/terminal-daemon.ts` (same rule as Pi Durable). It exposes a small port (`open(options) → { write, resize, close, foreground, exited }`), so tests use a fake port with no PTY.
- `server`: `GET /conversations/:id/terminals`, `POST /conversations/:id/terminals` (body `{ cols, rows }`, returns `TerminalInfo`), `DELETE /terminals/:id` (204), and one WebSocket `GET /api/terminals/:id/stream`. No business logic: it forwards to `core.terminals.attach`.
- `web`: `web/src/panes/**` (strip, tabs, route), `web/src/panes/terminal/**` (xterm wrapper, stream hook), new design-system parts in `components/ui` first (`pane-strip.tsx`, `terminal-view.tsx` with theme tokens read from CSS variables so light and dark work).
- `cli`: `tau terminals list <threadId>` and `tau terminals close <id>` (`commands.ts`, coverage test). No `open`: a terminal needs a screen.
- `testkit`: fake core terminals (a scripted echo shell, replay buffer, exit), contract tag `terminals` (pending for the real core until owner A is done).

### Stream protocol

- One WebSocket per attached pane, `GET /api/terminals/:id/stream`, through the existing guard (cookie, Host, Origin; `guard.ts:24-26` and `guard.ts:73` apply the origin check to every WebSocket upgrade). An unknown id closes with code 1008 and reason `not_found`.
- Server → client: first a text frame `{ "type": "ready", "status", "exitCode" }`, then **binary** frames of raw output (the replay buffer first, then live), then a text frame `{ "type": "exit", "exitCode" }`.
- Client → server: **binary** frames are input bytes; a text frame `{ "type": "resize", "cols", "rows" }` (TypeBox, validated, 1..500).
- Exception to "every frame is a TypeBox schema": raw output and input are binary by design; every text frame is a TypeBox schema. Say so in `protocol/src/terminal-stream.ts`.
- Backpressure: `RemoteTerminal` has only `onData` (`terminal.d.ts`): no pause signal, so the PTY cannot be slowed down. The replay buffer is a byte ring of 256 KB (the only unbounded-memory guard). A client whose socket `bufferedAmount` stays above 1 MB for 5 s is **closed** (code 1013); it reattaches and gets the ring again. `waitForDrain` (`server/src/live/backpressure.ts`) is not used. Input frames: `maxPayload` 64 KB on this socket; a larger paste is split by the browser.
- Replay safety: the ring starts at a chunk boundary and replay is prefixed with `ESC c` (full reset) so a cut escape sequence or a lost alternate-screen switch cannot corrupt the screen; a full-screen program (vim, top) repaints on the resize that follows attach (the client always sends its size right after `ready`).
- Size: the client that last sent `resize` owns the PTY size; a second attached client with another size shows a letterboxed view (known limit, no fight: only an *active typing* client resizes).

### Terminal service (core)

- One `Connection` to `localDaemon()` for the process, started on the first terminal (lazy), closed at `core.close()` (the daemon kills every PTY).
- `open`: resolve the thread's folder (`cwdOf(conversationId)`: a thread with a worktree uses `workspace.path`, else the project folder; rejects `not_found`, and `invalid_request` when the folder is gone), `env: { TERM: "xterm-256color", COLORTERM: "truecolor" }`, `inheritEnv: false` and an explicit copy of `process.env` without any `TAU_*` name and without names matching `/TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i` (`Connection` has no `env` option and spawns the daemon with tau's own environment, `connection.js:208`, so the filter must be in `TerminalOptions.env`). `TAU_HOME` and `TAU_THREAD_ID` are set as for agent shells (`coding-tools.ts:11-20`): a terminal is the user's own shell, so reaching tau's home is by design. A missing `SHELL` falls back to `/bin/sh`. Limits: 8 terminals per thread, 32 in total (`invalid_request` beyond).
- `exited` resolves → status `exited`, `Change` emitted; the record stays until the user closes it or the thread goes (so a reload shows "ended" with the last output).
- `close(id)`: `RemoteTerminal.close()`; idempotent for an ended terminal.
- Thread archive, delete and `workspaces.remove` call `closeAllOf(conversationId)` first (a shell inside a worktree would block its deletion).
- Kill switch: `TAU_DISABLE_TERMINALS=1` hides the button, routes answer `not_found`, nothing from pi-env loads.

### Web

- **Route**: `MainLayout.tsx:45` is a leaf `<Route path="/p/:projectId/c/:conversationId">`, so `/terminal/:terminalId` would fall to `path="*"`. It becomes `…/:conversationId/*`, and `ConversationRoute` reads `terminalId` with a nested `<Routes><Route path="terminal/:terminalId"/></Routes>` (or `useMatch`). `key={conversationId}` stays on the transcript so switching terminals never remounts it.
- **Layout**: `Conversation.tsx:80` is one `flex-col` (header, banner, scroll div, composer) inside `MainLayout.tsx:43` (`flex-col overflow-auto`). A new `ThreadPanes` wrapper (`flex-row`, `min-h-0 min-w-0`) puts the existing column (`h-full min-h-0 min-w-0`) next to the strip with a drag splitter (default 50 %, stored per browser). Scroll, auto-follow and the pinned composer must not change (test).
- xterm.js and its fit addon are **lazy-imported** (no cost for users who never open a terminal). Fit on resize with `ResizeObserver`, debounced; the size goes to the server as a `resize` frame.
- Copy and paste: xterm defaults, plus the browser's paste. Shortcut capture: while a terminal has focus the app's global shortcuts (`palette/GlobalShortcuts`) do nothing, except the shortcut that moves focus back to the composer.
- Mobile (<760 px): the strip shows tabs ("Chat", "Terminal 1", …); one is visible. Touch typing works; the key bar is out of scope.
- Fake mode (`VITE_FAKE=1`): the fake transport answers the routes and the stream with a scripted echo shell, so web tests and screenshots work without a backend.

### Round 2 changes (these override anything above that disagrees)

- **URL consumers**: `activity/use-open-conversation.ts:4` uses `useMatch("/p/:projectId/c/:conversationId")` with `end: true`; it would return `null` on a terminal URL and break `AppSidebar.tsx:32`, `MarkSeenWhileOpen.tsx:7`, `ToolsSection.tsx:43` and `use-setting-entries.ts:8`. Phase 0 changes the pattern to `…/:conversationId/*` there and in `MainLayout.tsx`, adds `terminalPath()` to `lib/paths.ts`, and adds a test that every consumer still gets the ids on a terminal URL. (`sidebar-model.ts:52` is prefix-only and stays.)
- **Close hooks, corrected**: no new `before*` kind. `conversation-removal.ts` runs `conversations.remove`, then the `onConversationRemoved` array; the worktree is discarded inside that array (`create-core.ts:244`). The terminal service registers **first** in the array (it also handles children, as `process-service.ts` does), and `projects-api.ts:95` runs it before `workspaces.onProjectRemoved`. `archived-cleanup` and delete-archived go through `removal.remove` (`archived-cleanup.ts:74`): covered. **Archive** runs no hook today and does not delete the worktree: `closeAllOf` is called directly from `archiveChildren`/archive in `conversations-api.ts:121` (one named call site, injected port). **`workspaces.remove`** (`workspace-service.ts:135-148`) is not a hook path: it receives the terminal service as an injected dependency and calls `closeAllOf` first. The fatal path is dropped from the hook list: `onFatal` exits at once (`create-core.ts:82,120`), so pin (g) is the guarantee.
- **Env, corrected**: the shell gets an **allow-list**, not a deny regex: `PATH` (with `$TAU_HOME/bin` prepended as in `coding-tools.ts:17-19`, so `tau` works), `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TERM`, `COLORTERM`, `TMPDIR`, `SSH_AUTH_SOCK`, `EDITOR`, `VISUAL`, `TAU_HOME`, `TAU_THREAD_ID`. Anything else is dropped (documented loss: custom variables; a later setting can extend the list).
- **Replay and repaint, corrected**: on attach the service sends `ESC c`, then the ring in chunks of at most 64 KB, then forces a repaint by resizing the PTY to (rows, cols+1) and back to (rows, cols) (a same-size resize may not raise `SIGWINCH`). Two clients: the **first attached client** owns the size until it detaches; later clients are read-only for size (letterboxed). Pin (i): a real `vim` and `top` survive a reload with the same size.
- **Packaging, corrected**: `packageRoot` is `new URL("..", import.meta.url)` (`ssh.js:25`), valid only while `pi-env` stays external in `node_modules`. `pi-env` is a direct dependency of `packages/cli` and `neverBundle` in `tsdown.config.ts:11`. "Unavailable" is decided by `existsSync(localDaemon())` inside a try/catch (`localDaemon()` throws on unknown platforms and does not check the file). Pin (b) runs the real built `dist/bin.js`; an e2e asserts the daemon file exists.
- **Core implementers**: the real core, `faux-core.ts` and testkit `createFakeCore` all get `terminals`. In web, `lib/transport/fake.ts` has a `Handlers` map keyed by `JsonRouteName` (`fake.ts:23`) that needs the new routes, and the stream is not a JSON route, so the `Transport` type gets a `openStream(path)` member (Phase 0).
- **Ownership**: Phase 0 owns every seam file: `rest.ts`, `commands.ts`, `core.ts`, `register-routes.ts`, `create-core.ts`, `removal-hooks.ts` and the hook call sites, `conversations-api.ts`, `workspace-service.ts`, `projects-api.ts`, `lib/transport/fake.ts` and the transport type, `lib/paths.ts`, `use-open-conversation.ts` and its consumers' tests, `MainLayout.tsx`, `tsdown.config.ts`, `package.json` files, the Biome `noRestrictedImports` override, `contract.test.ts`. Agents A–D fill only their own folders. The `cli` agent (D) is dropped: the commands are table rows, done in Phase 0.
- **Guard citation**: `packages/server/src/security/guard.ts:24` and `:73` is the right path (a round 2 note had the wrong directory).

### Folder, hooks, packaging (round 1 findings; superseded where round 2 above says so)

- **`cwdOf`** does not exist; write it in `core/src/terminals/cwd-of.ts` over `workspace-service.ts` (`threadOf`): a thread with a worktree uses `workspace.path`; checkout mode and legacy threads use the project folder (`legacyWorkspace(project.path)`); `workspace.state === "removed"` or a missing folder rejects `invalid_request`.
- **Close hooks**: add `beforeConversationRemoved` and `beforeProjectRemoved` to `RemovalHooks` (`removal-hooks.ts`), run **before** the worktree is deleted. Paths to cover and test: archive (including `archiveChildren`, `conversations-api.ts:121`), delete, delete-archived, `archived-cleanup`, `workspaces.remove`, project remove, `core.close()` (`create-core.ts:330`), and the fatal path (`harness.closed` → `onFatal`, `create-core.ts:119`).
- **Packaging**: `localDaemon()` returns `<package>/bin/pi-env-<platform>-<arch>/pi-env` (`ssh.js:302`), so `pi-env` must be a real directory in `node_modules`: add it to `packages/cli/package.json` `dependencies` (exact `1.3.0`) and to `neverBundle` in `tsdown.config.ts`, never bundle it. A platform with no daemon (musl, unknown arch, Windows) gives `terminals: unavailable` in the status, the button hidden, no crash.
- **Import rule**: only `core/src/harness/terminal-daemon.ts` imports `@earendil-works/pi-env`; its port exposes no pi-env types. Enforce with a Biome `noRestrictedImports` override (or a test that greps `core/src`).
- **CLI**: `terminals` is added to `COMMAND_NOUNS` (`commands.ts:24`); `terminals list` and `terminals close` are commands, and `close` is **not** destructive (the coverage test's exact destructive list stays at four); `POST /conversations/:id/terminals` goes in `COMMAND_EXCLUSIONS` with the reason "needs a screen"; the stream is not a REST route.
- **Design system**: `components/ui/terminal-view.tsx` is the one effectful part there (lazy `import("@xterm/xterm")`, CSS imported with it, DOM renderer so e2e can read text). It has `role="region"` with `aria-label="Terminal"`; tabs use the existing `tabs.tsx` (`role="tablist"`); a named shortcut (Ctrl+Shift+Up) moves focus back to the composer because xterm traps Tab. xterm screen-reader mode is on.
- **Web state**: `Change.resource: "terminals"` invalidates the query key `["terminals", conversationId]`. The tab title polls `foreground()` every 2 s only while a pane is attached.

## Phase 0 pins (foundation runs these first; results go in this doc)

- (a) **Done in review prep**: `openTerminal(new Connection({ command: [localDaemon()] }), …)` from a throwaway install of `@earendil-works/pi-env@1.3.0` on macOS arm64 started the login shell (zsh, prompt drawn, `pid` 10664), `resize()` worked, `foreground()` was `undefined` at the prompt, `close()` made `exited` reject with code `aborted`.
- (b) **Packaging**: `localDaemon()` finds the binary from a **built** `tau` CLI (`pnpm build`, then run the CLI from `dist`, with `pi-env` externalized like the Claude SDK or bundled with its `bin/` copied). The package is 17 MB (all platforms); only the host binary is used. Decide: dependency of `tau` (simple) versus optional install like the Claude SDK. Default: normal dependency, pinned exactly with Pi Durable (1.3.0).
- (c) Exec bit and macOS quarantine on the packaged daemon after `npx tau` (a fresh `npm i -g`).
- (d) Foreground job name: `foreground()` while `sleep 5` runs gives `{ pid, name: "sleep" }`.
- (e) Environment filter: with `inheritEnv: false` and the explicit copy, `printenv | grep -i 'TAU_\|TOKEN'` shows only `TAU_HOME` and `TAU_THREAD_ID`; `PATH`, `HOME`, `SHELL`, `LANG` are present so the shell works.
- (f) A 5 MB flood (`yes | head -c 5000000`) with a stalled client: the client is closed with 1013, memory stays bounded by the ring plus one socket buffer, and other sockets keep working. Also pin that `onData` chunk sizes allow a chunk-boundary ring.
- (g) Killing the tau process (SIGKILL) leaves no shell or daemon behind (check `ps`). If it does, add a parent-pid watchdog fallback before going on.
- (i) A real `vim` and `top` survive a reload with the repaint trick, at the same size.
- (h) `cwdOf` for: a thread with a worktree, a thread on the main checkout, a legacy thread, a thread whose worktree state is `removed`, a thread whose folder was deleted by hand.

## Phases and owners

0. **Foundation** (one agent): pins (b)–(i), dependency, protocol (`terminals`, stream frames, routes in `rest.ts`, command in `commands.ts` with the coverage test, `Change`), `Core.terminals` interface, fake core + contract tag (pending), `terminal-daemon.ts` port with a fake, stubs for each owner. Done when `check`, `test`, `build` pass.
1. **Parallel** (worktrees; the orchestrator commits their work):
   - **A: Core** owns `core/src/terminals/**` and `core/src/harness/terminal-daemon.ts` (service, ring buffer, lifecycle, `cwdOf`, close hooks).
   - **B: Server** owns `server/src/rest/register-terminal-routes.ts` and `server/src/terminals/**` (stream socket, backpressure, close codes).
   - **C: Web** owns `web/src/panes/**`, the new `components/ui` parts, the route, and the fake transport additions.
2. **Integration** (one agent): applies notes, wires `create-core.ts` and `create-server.ts`, thread archive/delete hooks, e2e (open a terminal, type `echo hi`, see the output, reload and see it again, close, thread delete kills it), runs `check` and `test` after each merge.
3. **Verify for real**: build, run on a scratch home and port (never the user's real tau home or port), open the app in a browser, open a terminal in a worktree thread, run `pwd`, `ls`, `vim`, `top`, resize the window, reload, open a second tab, close the terminal, archive the thread. Light and dark theme, phone width. The user then checks it on their own server.

## Testing

- Core: ring buffer (overflow keeps the newest 256 KB, replay order), attach/detach with two clients, `exited` marks status and emits `Change`, `closeAllOf`, `cwdOf` cases, env filter, kill switch, close at `core.close()`. One real-PTY test with `/bin/sh` (`echo $((6*7))` → `42`), skipped when the daemon binary is missing.
- Server: stream frame order (ready, replay, live, exit), invalid resize closes 1008, unknown id, Origin and cookie required (reuse the security suite), backpressure with a paused client.
- Web: strip layout desktop and narrow, route restores the focused pane, ended state, lazy import not loaded on a thread view, no global shortcut fires while the terminal has focus.
- Contract tag `terminals` passes for the fake and the real core.
- e2e as above.

## Risks

- **A terminal is a remote shell**: it equals full control of the machine as the user. Today tau is localhost with a token, Host/Origin checks and a cookie. Before remote access (PLAN.md) ships, the stream needs per-device auth and an explicit "allow terminals" setting. This plan keeps the existing guard and adds the kill switch.
- **pi-env packaging and its Rust daemon**: pin (b) and (c). pi-env is young (1.3.0, same family as Pi Durable); pin its version with Pi Durable.
- **Output floods and memory**: pin (f); ring buffer size is fixed.
- **Orphans**: pin (g). The daemon kills PTYs when its connection is lost, but a SIGKILLed tau needs proof.
- **Keyboard capture** inside the app: global shortcuts must not eat terminal keys.
- **Worktree deletion with a shell inside**: `closeAllOf` before removal.

## Open questions for the user

1. URL shape `/p/:projectId/c/:conversationId/terminal/:terminalId` — OK, or a query parameter (`?pane=terminal:<id>`)?
2. Several terminals per thread now, or exactly one for the first cut?
3. Dependency on `pi-env` in the normal `tau` install (+17 MB) — OK?
