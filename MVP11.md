# MVP11 plan: thread panes, starting with a terminal

Status: DRAFT v4 (review rounds 1–3 applied as one text; round 4 pending). Builds on PLAN.md "Later → Thread panes" and "Built-in terminal".

## Goal

> In any thread I open a terminal next to the transcript. It is a real shell in the thread's folder (its worktree). It survives a page reload.

## Scope

In:
1. **Pane strip** in the thread view: the transcript plus open panes, side by side on desktop, tabs below 760 px. One pane kind now: `terminal`. The strip is generic (a pane has `kind` and `id`), so later kinds need no layout change.
2. **Terminal pane**: xterm.js in the browser, a PTY on the machine that runs tau, started by the `pi-env` daemon (`openTerminal`, `localDaemon()`). The shell is the user's login shell. Its folder is the thread's folder (worktree, or the project folder for a thread without one).
3. **Several terminals per thread**: open (button "Terminal" in the thread toolbar), close, switch. Each has a title (`zsh`, or the foreground job name from `foreground()`). Limits: 8 per thread, 32 in total (`invalid_request` beyond).
4. **Reload and reconnect keep the screen**: the service keeps the last 256 KB of raw output per terminal and replays it on attach. Many browser tabs can attach to one terminal.
5. **URL**: the focused pane is in the URL, `/p/:projectId/c/:conversationId/terminal/:terminalId`. Back and forward work, a link reopens the same view (if the terminal is still running; else a "This terminal ended" state).
6. **Lifetime**: a terminal ends when its shell exits, when the user closes it, when the thread is archived or deleted, and when tau stops (the daemon kills it). Terminals do **not** survive a tau restart.

Out (later plans): agent tools that open, write to or read panes; other pane kinds (browser, file tree, editor, diff); a touch key bar for phones (typing Esc/Ctrl needs it); terminals on a remote runtime (the same `RemoteTerminal` API works over the bridge in PLAN.md); persistence across restarts; Windows (pi-env has no terminals there); setup steps that open a terminal with a typed command.

## Design

### Packages

- `protocol`: `TerminalInfo { id, conversationId, title, status: "running" | "exited", exitCode: number | null, createdAt }`, `Change` += `{ resource: "terminals", conversationId }`, REST routes, WS control frames (TypeBox), `TERMINAL_STREAM_PATH`, and a `terminals` availability flag in the status the web already reads.
- `core`: `Core.terminals { list(conversationId), open(conversationId, { cols, rows }), close(id), attach(id, { onData, onExit }) → { write, resize, detach } }`. Code in `core/src/terminals/**`. The **only** file that imports `@earendil-works/pi-env` is `core/src/harness/terminal-daemon.ts` (same rule as Pi Durable); its port (`open(options) → { write, resize, close, foreground, exited }`) exposes no pi-env types, so tests use a fake port with no PTY. A Biome `noRestrictedImports` override enforces it. Implementers of `Core`: the real core, `faux-core.ts`, testkit `createFakeCore`.
- `server`: `GET /conversations/:id/terminals`, `POST /conversations/:id/terminals` (body `{ cols, rows }`, returns `TerminalInfo`), `DELETE /terminals/:id` (204), and one WebSocket `GET /api/terminals/:id/stream`. No business logic: it forwards to `core.terminals.attach`.
- `web`: `web/src/panes/**` (strip, tabs, route), `web/src/panes/terminal/**` (stream hook), design-system parts in `components/ui` first (`pane-strip.tsx`, `terminal-view.tsx`).
- `cli`: `tau terminals list <threadId>` and `tau terminals close <id>`. No `open`: a terminal needs a screen.
- `testkit`: fake core terminals (a scripted echo shell, replay buffer, exit), contract tag `terminals` (pending for the real core until owner A is done).

### Stream protocol

- One WebSocket per attached pane, `GET /api/terminals/:id/stream`, through the existing guard (cookie, Host, Origin; `security/guard.ts:24` `needsOriginCheck` and `:73` apply the origin check to every WebSocket upgrade). An unknown id closes with code 1008 and reason `not_found`.
- Server → client: a text frame `{ "type": "ready", "status", "exitCode" }`, then **binary** frames of raw output (replay first, then live), then a text frame `{ "type": "exit", "exitCode" }`.
- Client → server: **binary** frames are input bytes; a text frame `{ "type": "resize", "cols", "rows" }` (TypeBox, 1..500). The client sends its size right after `ready`.
- Exception to "every frame is a TypeBox schema": raw output and input are binary by design; every text frame is a TypeBox schema. Say so in `protocol/src/terminal-stream.ts`.
- **Backpressure**: `RemoteTerminal` has only `onData` (`terminal.d.ts`): no pause signal. The 256 KB ring is the only memory guard. A client whose socket `bufferedAmount` stays above 1 MB for 5 s is closed (code 1013); it reattaches and gets the ring again. `waitForDrain` is not used. Input frames: `maxPayload` 64 KB on this socket (the browser splits a larger paste). Replay frames are at most 64 KB.
- **Replay**: the ring starts at a chunk boundary. On attach the service sends to the new client only: `ESC c` (full reset), then a **mode prefix**, then the ring. The ring tracker scans every output chunk (keeping a short tail across chunk boundaries) and records the last state of these private modes: `?1049` and `?47` (alternate screen), `?25` (cursor), `?1` (application cursor keys), `?2004` (bracketed paste), `?1000 ?1002 ?1003 ?1006` (mouse). The prefix re-sets them, so a ring cut after `vim` entered the alternate screen still replays in the alternate screen, and quitting restores the shell screen.
- **Repaint**: after replay, when `foreground()` is defined (a full-screen job runs), the service resizes the PTY to `resize(cols + 1, rows)` and back to `resize(cols, rows)` (the API is `resize(cols, rows)`; a same-size resize may not raise `SIGWINCH`). At a plain shell prompt no repaint is sent, so zsh does not draw a second prompt. The repaint output goes to every attached client: harmless extra redraw, documented.
- **Size owner**: the most recently attached client that has sent a `resize` owns the PTY size; when it detaches, the most recent remaining client becomes the owner. Other clients show a letterboxed view. (A reload attaches the new socket before the old one closes, so the new one takes over at once.)

### Terminal service (core)

- One `Connection` to `localDaemon()` for the process, started on the first terminal (lazy), closed at `core.close()` (the daemon kills every PTY).
- **Availability**: `existsSync(localDaemon())` and `accessSync(…, X_OK)` inside a try/catch (`localDaemon()` throws on unknown platforms and does not check the file). Unavailable (musl, unknown arch, Windows, missing exec bit, `TAU_DISABLE_TERMINALS=1`) means the status says so, the button is hidden, routes answer `not_found`, nothing from pi-env loads, no crash.
- **`open`**: `cwdOf(conversationId)` in `core/src/terminals/cwd-of.ts` over `workspaces/workspace-service.ts` (`threadOf`): a thread with a worktree uses `workspace.path`; checkout and legacy threads use the project folder (`legacyWorkspace(project.path)`); `workspace.state === "removed"` or a missing folder rejects `invalid_request`; an unknown thread `not_found`. The shell's environment is `inheritEnv: false` with an **allow-list** copied from tau's `process.env`: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TMPDIR`, `SSH_AUTH_SOCK`, `EDITOR`, `VISUAL`, `XDG_*`, `DISPLAY`, plus `TERM=xterm-256color`, `COLORTERM=truecolor`, `TAU_HOME`, `TAU_THREAD_ID`. `PATH` is tau's own `PATH` with `$TAU_HOME/bin` prepended as in `coding-tools.ts:17-19` (so `tau` works; a tau started by launchd has a thin `PATH`: documented). A missing `SHELL` falls back to `/bin/sh`. Everything else is dropped: no token, no secret, no custom variable (documented loss; a later setting can extend the list). `Connection` has no `env` option and starts the daemon with tau's environment (`connection.js:208`), so the filter lives in `TerminalOptions.env`. Reaching `TAU_HOME` is by design: the terminal is the user's own shell.
- `exited` resolves → status `exited`, `Change` emitted; the record stays until the user closes it or the thread goes (a reload shows "ended" with the last output).
- `close(id)`: `RemoteTerminal.close()`; idempotent for an ended terminal.
- **`closeAllOf(conversationId)` call sites** (it keys on the conversation id and never reads the store):
  1. **Delete and children, delete-archived, `archived-cleanup`**: the terminal service is the **first** entry of the `onConversationRemoved` array (`removal-hooks.ts:25-34`), before the worktree discard (`create-core.ts:244`); it also closes children's terminals, as `process-service.ts` does. `archived-cleanup` goes through `removal.remove` (`archived-cleanup.ts:74`): covered.
  2. **Project remove**: `projects-api.ts:94-96` runs the conversation hooks and then `runProjectRemoved`; the terminal hook runs before `workspaces.onProjectRemoved`.
  3. **Archive** (including `archiveChildren`, `conversations-api.ts:121-128` and `:182-185`): no hook exists; one named direct call through an injected port.
  4. **`workspaces.remove`** (`workspaces/workspace-service.ts:135-148`): inside `lock.run`, **after** `requireIdle` and the unmerged-work check, right before `removeOne` and the shared-worktree `update`. A rejected remove must leave terminals running (test).
  5. `core.close()` (`create-core.ts:330`) closes the connection. The fatal path (`onFatal` exits at once, `create-core.ts:82,120`) has no hook: pin (g) is the guarantee.

### Web

- **Route**: `MainLayout.tsx:45` is a leaf `<Route path="/p/:projectId/c/:conversationId">`; a terminal URL would fall to `path="*"`. It becomes `…/:conversationId/*`; `ConversationRoute` reads `terminalId` from a nested `<Routes><Route path="terminal/:terminalId"/></Routes>` (or `useMatch`). `key={conversationId}` stays on the transcript so switching terminals never remounts it.
- **URL consumers**: `activity/use-open-conversation.ts:4` calls `useMatch("/p/:projectId/c/:conversationId")` with `end: true` and would return `null` on a terminal URL. Its consumers: `AppSidebar.tsx:32`, `MarkSeenWhileOpen.tsx:7`, `ToolsSection.tsx:43`, `use-setting-entries.ts:8`, `CommandPalette`, `GlobalShortcuts`, `NotificationWatcher` (also imported through `@/activity`). The pattern becomes `…/:conversationId/*`; `lib/paths.ts` gets `terminalPath()`. One test asserts the ids on a URL with no suffix, with `/terminal`, and with `/terminal/:id` for all seven consumers. `sidebar-model.ts:52` is prefix-only and stays.
- **Layout**: `Conversation.tsx:80` is one `flex-col` (header, banner, scroll div, composer) inside `MainLayout.tsx:43` (`flex-col overflow-auto`). A new `ThreadPanes` wrapper (`flex-row`, `min-h-0 min-w-0`) puts the existing column (`h-full min-h-0 min-w-0`) next to the strip with a drag splitter (default 50 %, stored per browser). Scroll, auto-follow and the pinned composer must not change (test).
- **xterm**: `components/ui/terminal-view.tsx` is the one effectful part in the design system (lazy `import("@xterm/xterm")` and its fit addon, CSS imported with them, DOM renderer so e2e can read text, theme from CSS variables for light and dark). Fit on resize with `ResizeObserver`, debounced, sent as a `resize` frame. `role="region"` with `aria-label="Terminal"`; screen-reader mode on; tabs use `tabs.tsx` (`role="tablist"`).
- **Keys**: while a terminal has focus the global shortcuts (`palette/GlobalShortcuts`) do nothing, except Ctrl+Shift+Up, which moves focus back to the composer (xterm traps Tab).
- **State**: `Change.resource: "terminals"` invalidates the query key `["terminals", conversationId]`. The tab title polls `foreground()` every 2 s only while a pane is attached.
- **Mobile** (<760 px): the strip shows tabs ("Chat", "Terminal 1", …); one is visible. Touch typing works; the key bar is out of scope.
- **Fake mode** (`VITE_FAKE=1`): `lib/transport/fake.ts` has a `Handlers` map keyed by `JsonRouteName` (`fake.ts:23`) that gets the new routes; the stream is not a JSON route, so `Transport` (`lib/transport/types.ts:23`, today `request` and `live`) gains `openStream(path)`. The fake answers with a scripted echo shell, so tests and screenshots work without a backend.

### Packaging

`localDaemon()` returns `<packageRoot>/bin/pi-env-<platform>-<arch>/pi-env`, and `packageRoot` is `new URL("..", import.meta.url)` (`ssh.js:25`). It works only while `pi-env` stays a real directory in `node_modules`. So: `@earendil-works/pi-env` at exact `1.3.0` (with Pi Durable) is a dependency of `packages/cli` **and** `packages/core` (pnpm does not resolve it from another package), and is in `neverBundle` (`packages/cli/tsdown.config.ts:11`). It is a normal dependency (+17 MB, all platforms; only the host binary runs), not an optional install like the Claude SDK.

### CLI

`terminals` is added to `COMMAND_NOUNS` (`commands.ts:24`); `terminals list` and `terminals close` are commands, and `close` is **not** destructive (the coverage test's exact destructive list stays at four); `POST /conversations/:id/terminals` goes in `COMMAND_EXCLUSIONS` with the reason "needs a screen"; the stream is not a REST route.

## Phase 0 pins (foundation runs these first; results go in this doc)

- (a) **Done**: `openTerminal(new Connection({ command: [localDaemon()] }), …)` from a throwaway install of pi-env 1.3.0 on macOS arm64 started the login shell, `resize()` worked, `foreground()` was `undefined` at the prompt, `close()` made `exited` reject with code `aborted`.
- (b) **Packaging**: run the real built `dist/bin.js` (`pnpm build`) and open a terminal; an e2e asserts the daemon file exists and is executable.
- (c) Exec bit and macOS quarantine on the packaged daemon after a fresh `npm i -g tau`.
- (d) `foreground()` while `sleep 5` runs gives `{ pid, name: "sleep" }`.
- (e) **Done in review (round 3)**: with `inheritEnv: false` and an allow-list, the login shell is `-zsh`, `HOME`, `PATH` and `vim`/`top` work, and only `TAU_HOME` and `TAU_THREAD_ID` match `^TAU`. Re-run with the final allow-list.
- (f) A 5 MB flood (`yes | head -c 5000000`) with a stalled client: the client is closed with 1013, memory stays bounded by the ring plus one socket buffer, other sockets keep working; note `onData` chunk sizes.
- (g) SIGKILL of the tau process leaves no shell and no daemon (check `ps`), on macOS and on Linux. If it does, add a parent-pid watchdog before going on.
- (h) `cwdOf` for: a thread with a worktree, a thread on the main checkout, a legacy thread, a thread whose worktree state is `removed`, a thread whose folder was deleted by hand.
- (i) **Partly done in review (round 3)**: a resize to cols+1 and back makes `vim` and `top` redraw with `\e[H\e[2J` and the full screen. Still to pin: with the mode prefix, a reload after the ring wrapped (`top` running for minutes) stays in the alternate screen, and quitting restores the shell screen.

## Phases and owners

0. **Foundation** (one agent): pins (b)–(i); dependency, `neverBundle`, Biome override; protocol (`terminals`, stream frames, routes in `rest.ts`, commands in `commands.ts` with the coverage test, `Change`); `Core.terminals` for the real core, `faux-core.ts` and `createFakeCore`; fake core and contract tag (pending); `terminal-daemon.ts` port with a fake; the hook seams and call sites (`removal-hooks.ts`, `create-core.ts`, `conversations-api.ts`, `workspaces/workspace-service.ts`, `projects-api.ts`); `register-routes.ts`; the web seams (`MainLayout.tsx`, `use-open-conversation.ts` and the consumer test, `lib/paths.ts`, `lib/transport/types.ts`, `fake.ts`); stubs for each owner. Done when `check`, `test` and `build` pass.
1. **Parallel** (worktrees; the orchestrator commits their work). Nobody edits files they do not own; needed changes go in a note for the integrator.
   - **A: Core** owns `core/src/terminals/**` and `core/src/harness/terminal-daemon.ts` (service, ring buffer and mode tracker, replay, repaint, size owner, lifecycle, `cwdOf`, `closeAllOf`).
   - **B: Server** owns `server/src/rest/register-terminal-routes.ts` and `server/src/terminals/**` (stream socket, backpressure, close codes).
   - **C: Web** owns `web/src/panes/**`, the new `components/ui` parts, and the fake transport's terminal handlers.
2. **Integration** (one agent): applies notes, wires `create-server.ts`, e2e (open a terminal, type `echo hi`, see the output, reload and see it again, close, thread delete kills it), runs `check` and `test` after each merge.
3. **Verify for real**: build, run on a scratch home and port (never the user's real tau home or port), open the app in a browser, open a terminal in a worktree thread, run `pwd`, `ls`, `vim`, `top`, resize the window, reload, open a second tab, close the terminal, archive the thread. Light and dark theme, phone width. The user then checks it on their own server.

## Testing

- Core: ring overflow keeps the newest 256 KB, replay order; mode tracker across chunk boundaries and wrap; attach/detach with two clients and size-owner handover; `exited` marks status and emits `Change`; every `closeAllOf` site, including "a rejected `workspaces.remove` leaves terminals running"; `cwdOf` cases; env allow-list; kill switch and unavailable state; close at `core.close()`. One real-PTY test with `/bin/sh` (`echo $((6*7))` → `42`), skipped when the daemon binary is missing.
- Server: frame order (ready, replay, live, exit), invalid resize closes 1008, unknown id, Origin and cookie required (reuse the security suite), oversize input frame, stalled client closed with 1013.
- Web: strip layout desktop and narrow; route restores the focused pane; URL-consumer test (above); ended state; lazy import not loaded on a thread view; no global shortcut fires while the terminal has focus; composer stays pinned.
- Contract tag `terminals` passes for the fake and the real core, including replay-then-live ordering.
- e2e as above.

## Risks

- **A terminal is a remote shell**: full control of the machine as the user. Today tau is localhost with a token, Host/Origin checks and a cookie. Before remote access (PLAN.md) ships, the stream needs per-device auth and an explicit "allow terminals" setting. This plan keeps the existing guard and adds the kill switch.
- **pi-env packaging and its Rust daemon**: pins (b), (c). pi-env is young (1.3.0, same family as Pi Durable); pin it with Pi Durable.
- **Output floods and memory**: pin (f); the ring size is fixed.
- **Orphans**: pin (g).
- **Full-screen replay**: pin (i); the mode tracker is the weakest part.
- **Keyboard capture** inside the app: global shortcuts must not eat terminal keys.
- **Worktree deletion with a shell inside**: `closeAllOf` before removal, but never for a rejected removal.

## Decisions (defaults; the user can change them)

1. URL shape `/p/:projectId/c/:conversationId/terminal/:terminalId`.
2. Several terminals per thread now.
3. `pi-env` is a normal dependency of the `tau` install (+17 MB).
