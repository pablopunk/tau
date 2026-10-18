# MVP11 plan: thread panes, starting with a terminal

Status: DRAFT v1 (awaiting review rounds). Builds on PLAN.md "Later → Thread panes" and "Built-in terminal".

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
- Backpressure: reuse `waitForDrain` (`server/src/live/backpressure.ts`). The replay buffer is a byte ring of 256 KB; output is never dropped for an attached client, a slow client is paused (the PTY blocks), and a client that stays blocked for 30 s is closed.
- Size: the attached client that last resized owns the PTY size.

### Terminal service (core)

- One `Connection` to `localDaemon()` for the process, started on the first terminal (lazy), closed at `core.close()` (the daemon kills every PTY).
- `open`: resolve the thread's folder (`cwdOf(conversationId)`: a thread with a worktree uses `workspace.path`, else the project folder; rejects `not_found`, and `invalid_request` when the folder is gone), `env: { TERM: "xterm-256color", COLORTERM: "truecolor" }`, `inheritEnv: true` **minus** `TAU_*` variables (the daemon is spawned with a filtered environment; the session token never reaches the shell).
- `exited` resolves → status `exited`, `Change` emitted; the record stays until the user closes it or the thread goes (so a reload shows "ended" with the last output).
- `close(id)`: `RemoteTerminal.close()`; idempotent for an ended terminal.
- Thread archive, delete and `workspaces.remove` call `closeAllOf(conversationId)` first (a shell inside a worktree would block its deletion).
- Kill switch: `TAU_DISABLE_TERMINALS=1` hides the button, routes answer `not_found`, nothing from pi-env loads.

### Web

- `ConversationRoute` gains the `terminal/:terminalId` child route. The pane strip sits in `Conversation.tsx` beside the transcript panel; the transcript keeps its own scroll and composer.
- xterm.js and its fit addon are **lazy-imported** (no cost for users who never open a terminal). Fit on resize with `ResizeObserver`, debounced; the size goes to the server as a `resize` frame.
- Copy and paste: xterm defaults, plus the browser's paste. Shortcut capture: while a terminal has focus the app's global shortcuts (`palette/GlobalShortcuts`) do nothing, except the shortcut that moves focus back to the composer.
- Mobile (<760 px): the strip shows tabs ("Chat", "Terminal 1", …); one is visible. Touch typing works; the key bar is out of scope.
- Fake mode (`VITE_FAKE=1`): the fake transport answers the routes and the stream with a scripted echo shell, so web tests and screenshots work without a backend.

## Phase 0 pins (foundation runs these first; results go in this doc)

- (a) **Done in review prep**: `openTerminal(new Connection({ command: [localDaemon()] }), …)` from a throwaway install of `@earendil-works/pi-env@1.3.0` on macOS arm64 started the login shell (zsh, prompt drawn, `pid` 10664), `resize()` worked, `foreground()` was `undefined` at the prompt, `close()` made `exited` reject with code `aborted`.
- (b) **Packaging**: `localDaemon()` finds the binary from a **built** `tau` CLI (`pnpm build`, then run the CLI from `dist`, with `pi-env` externalized like the Claude SDK or bundled with its `bin/` copied). The package is 17 MB (all platforms); only the host binary is used. Decide: dependency of `tau` (simple) versus optional install like the Claude SDK. Default: normal dependency, pinned exactly with Pi Durable (1.3.0).
- (c) Exec bit and macOS quarantine on the packaged daemon after `npx tau` (a fresh `npm i -g`).
- (d) Foreground job name: `foreground()` while `sleep 5` runs gives `{ pid, name: "sleep" }`.
- (e) Environment filter: `printenv | grep ^TAU_` in the terminal is empty while tau runs with a token.
- (f) A 5 MB flood (`yes | head -c 5000000`) with a slow client does not grow memory beyond the ring and does not block the server's other sockets.
- (g) Killing the tau process (SIGKILL) leaves no shell or daemon behind (check `ps`).
- (h) `cwdOf` for: a thread with a worktree, a thread on the main checkout, a thread whose folder was deleted.

## Phases and owners

0. **Foundation** (one agent): pins (b)–(h), dependency, protocol (`terminals`, stream frames, routes in `rest.ts`, command in `commands.ts` with the coverage test, `Change`), `Core.terminals` interface, fake core + contract tag (pending), `terminal-daemon.ts` port with a fake, stubs for each owner. Done when `check`, `test`, `build` pass.
1. **Parallel** (worktrees; the orchestrator commits their work):
   - **A: Core** owns `core/src/terminals/**` and `core/src/harness/terminal-daemon.ts` (service, ring buffer, lifecycle, `cwdOf`, close hooks).
   - **B: Server** owns `server/src/rest/register-terminal-routes.ts` and `server/src/terminals/**` (stream socket, backpressure, close codes).
   - **C: Web** owns `web/src/panes/**`, the new `components/ui` parts, the route, and the fake transport additions.
   - **D: CLI** owns the two commands' handlers if `packages/cli` needs any beyond the command table.
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
4. Should the terminal's shell start in the thread's worktree even for a thread that has no worktree yet (then the project folder)?
