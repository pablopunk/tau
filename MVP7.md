# MVP7 plan: agents control tau

Status: APPROVED v5 (review rounds 1–5; round 5 minors applied). If Phase 0 overruns, split `cli-entry.ts`, the lock `version` and the service types into a Phase 0b. Builds on the rename (pi-everywhere → tau) and [MVP6.md](MVP6.md).

## Goal

> Anything a user can do in the app, an agent can do too: agents inside tau (through bash) and agents outside it (Claude Code, Codex, a script).

## Decision

A `tau` CLI that calls the existing REST API, plus a bundled `tau` skill that teaches agents to use it. Not one tool per action (context cost), not raw curl (agents get auth and JSON bodies wrong). The REST API stays the single source of truth.

## Scope

In:
1. **A command for every JSON route** in `protocol/src/rest.ts`, except a listed set of exclusions. Commands use "thread"; routes keep "conversation".
2. **Agent helpers** that are not routes: `--wait` on `threads start` / `threads send`, `tau threads wait <id>`, `tau threads read <id> [--last N]`, `tau skill`.
6. **The server as a durable user service** on macOS, Linux and Windows, managed by the CLI (see below).
3. **Auth with no setup**: the CLI reads the URL from `<home>/lock` and the token from `<home>/token`; the server accepts `Authorization: Bearer <token>`.
4. **Agents inside tau**: their bash has `tau` on `PATH` and `TAU_HOME` and `TAU_THREAD_ID`.
5. **Bundled `tau` skill**: listed for every agent inside tau (subagents and forks too); `tau skill` prints it for outside agents.

Out: an MCP server, remote machines, images in messages from the CLI, ChatGPT sign-in from the CLI.

**Security model (accepted)**: the token is one full-power secret, and every agent inside tau can already read `<home>/token`. The CLI gives agents nothing they could not do before; it makes it reliable. Provider keys are never returned by any route (Phase 0 test asserts it on `ProviderInfo` and `Settings`).

## Commands

One hand-written table, `protocol/src/commands.ts`:

```ts
{ command: "threads send", route: "sendMessage", summary: "Send a message to a thread",
  positionals: ["params.id", "body.text"], destructive: false }
```

- **Positionals** are listed per command. Every other top-level primitive body or query field is a flag (`--model`, `--force`). The literal `none` sets a nullable field to `null` (`tau settings set-default-thinking none`). A boolean is `--flag` / `--no-flag`. Nested objects need `--json '<body>'`, which replaces the whole body; flags are not merged into it.
- A `requestId` field the user does not give is filled with a random id.
- Input is checked with TypeBox before the request; a usage error exits 2.
- Output is JSON on stdout. An `AppError` prints `code: message` on stderr and exits 1.
- `--help` lists the nouns, the commands of a noun, or a command's positionals and flags, from the table's `summary` and the schema field names. Help is not generated from schema descriptions.
- **Destructive commands** (`threads delete`, `threads delete-archived`, `projects remove`, `workspaces remove`) need `--yes`. The CLI refuses to delete or archive the thread in `TAU_THREAD_ID` or its parents.

Nouns: `settings`, `providers`, `models`, `skills`, `projects`, `github`, `threads`, `workspaces`, `checkpoints`, `processes`, `mcp`.

**Exclusions** (each one has a reason in the table): `getProjectIcon`, `getIconCandidate`, `listIconCandidates`, `setProjectIcon`, `resetProjectIcon` (images); `startLogin`, `getLogin`, `submitLoginUrl`, `cancelLogin` (browser sign-in); `suggestDirectories`, `getSuggestedCodeFolder`, `suggestProjectFiles` (typing helpers for the UI; agents have `ls`).

Examples:
```sh
tau projects list
tau threads start --project <id> "Fix the flaky test" --wait
tau threads send <id> "Also update the README" --wait
tau threads read <id> --last 5
tau threads archive <id>
tau workspaces merge <id>
tau settings set-default-model openrouter/anthropic/claude-sonnet-5-5
```

## Server as a durable service (user request: the CLI is the first way in, on any OS)

After `npm i -g tau` nothing runs yet. The CLI installs the server as a user service that starts at login and restarts after a crash or a reboot.

- `tau` with no command does four things:
  1. it installs the service when it is not installed;
  2. it repairs the service when the recorded node or entry path is not the current one;
  3. it starts the service when it is not running;
  4. it opens the browser.
- The service runs `"<node>" "<cli entry>" serve --service --no-open`, with absolute paths. One function, `cli/src/cli-entry.ts` (Phase 0), gives the node and entry paths for the service and for core's `<home>/bin/tau` shim.
- **Environment**: service managers start with a minimal `PATH`. Install copies the user's current `PATH` into the unit, so agents find `git`, `gh`, `mise` and `pnpm`. `install` and `restart` refresh it. Provider keys that come only from shell env vars are not copied; install lists them and says "save these in Settings → Providers".
- **One server per home**: `serve --service` never exits because another instance holds the lock (for example a foreground `tau serve`). It waits, checks the lock every 5 s, and starts when the lock is free. So no manager sees an exit loop. `status` says "running (foreground)" or "running (service)".
- **Port**: the first start stores its port in `<home>/port`, and later starts use it. When the port is taken by another program, the server takes the next free port and stores that one. `status` prints the real URL.
- **Version**: the lock gets `version` (Phase 0). `status` warns when the running version is not the CLI version: "run `tau restart`".
- **Node paths from mise or nvm**: the unit records `process.execPath`. Bare `tau`, `status` and `restart` compare it and the entry with the current ones, and reinstall when they differ or are missing. `status` shows "node missing" when the recorded node is gone. `install` refuses an entry inside an npx or `pnpm dlx` cache: "install tau globally first".
- **Per OS** (all per-user, no admin rights):
  - **macOS**: launchd agent `~/Library/LaunchAgents/dev.tau.server.plist` with `RunAtLoad`, `KeepAlive` and `EnvironmentVariables`.
    - `install`: `bootout` (an error for a job that is not loaded is ignored), then `bootstrap gui/<uid>`.
    - `restart`: `kickstart -k`.
    - `stop`: `bootout`. The service stays stopped until `tau start` or the next login.
    - `start`: `bootstrap`.
  - **Linux**: systemd user unit `~/.config/systemd/user/tau.service` with `Restart=always`, `RestartSec=5`, `Environment=PATH=…` and `WantedBy=default.target`.
    - `install`: `systemctl --user enable --now`, then `loginctl enable-linger $USER`, so the service runs after a reboot with no login. A failed linger gives a warning.
    - Without a usable user systemd (no `XDG_RUNTIME_DIR`, some WSL or containers): a detached process and a warning that it will not survive a reboot.
  - **Windows**: a Task Scheduler task at logon, from XML (`schtasks /create /xml`).
    - The XML sets `ExecutionTimeLimit PT0S`, `DisallowStartIfOnBatteries false`, `StopIfGoingOnBatteries false`, and `RestartOnFailure` (`Interval PT1M`, `Count 999`).
    - It runs through `conhost.exe --headless`, so no console window opens.
    - `PATH` goes in through a small `tau-service.cmd` wrapper in `<home>/bin`.
    - Because restart-on-failure needs a non-zero exit, `serve --service` exits 1 on a crash.
- **Commands**: `tau start`, `tau stop`, `tau restart`, `tau status [--json]`, `tau open`, `tau logs [-f]`, `tau service install`, `tau service uninstall [--home <path>]`, `tau service list`.
  - `status` shows: installed, running (service or foreground), pid, URL, version, home, and node.
  - `service list` shows every tau service of this user, dev homes included.
- `tau start` uses the installed service for that home. For a home with no service (for example `--home <tmp>` in e2e), it starts a detached process.
- `tau serve` runs the server in the foreground (today's behavior; for e2e and development). Server flags (`--port`, `--home`, `--faux`, `--no-open`, `--service`) go on `serve` and `start`. Phase 0 defines all of them in `options.ts`. A `--port` flag wins over `<home>/port` and updates it.
- macOS without a GUI session (ssh): use `user/<uid>` in place of `gui/<uid>`; if that fails too, use the detached fallback with a warning.
- The copied `PATH` puts the mise shims folder (when present) before versioned tool folders, so a removed tool version does not break agents; `restart` copies it again.
- Windows needs Windows 10 1809 or later (`conhost --headless`); older versions get the detached fallback.
- API commands do not install anything. When the server is not running, they exit 1 with "tau is not running. Run `tau` to start it."
- **Logs**: the server writes `<home>/logs/server.log` itself and rotates it at 10 MB, keeping one old file. Managers get no stdout redirect.
- A `--home` other than the default gets its own service name (`dev.tau.server.<hash>`), so tests and dev homes never replace the user's service.

## Waiting

- `--wait` on `send` reads the thread's `lastRunEndedAt` (R0) **before** the request; on `start`, R0 is `null`. It is done when all of these are true:
  1. the thread `status` is `idle`;
  2. `lastRunEndedAt` is later than R0;
  3. the view's queue is empty, so a message queued behind a running run counts;
  4. no child has `agentStatus: "running"`, because a child report wakes the parent again.
- `tau threads wait <id>` uses the same rule without condition 2.
- Summaries come from `listAllConversations`, fetched again on each `changed` frame. The frame has no thread id, so every frame causes a full re-list; that is acceptable at this scale. The view subscription is used only for condition 3 and for the final answer text.
- A message that never starts a run (dropped, or the thread is stuck) ends in the normal timeout. A concurrent send from someone else can end another run after R0 and satisfy the rule early; this is accepted.
- A thread that ends in `error` makes wait exit 1 and print the error. `--timeout <s>` (default 600) exits 3. On success, wait prints the last assistant answer as text.

## Server

- `guard.ts` order: Host check → if an `Authorization` header is present: a wrong or malformed Bearer is 401 (no cookie fallback); a present `Origin` must be allowed, else 403; an absent `Origin` is accepted → else the existing token-exchange and cookie flow, unchanged.
- The compare uses the existing `session.isValidToken` (sha256 + `timingSafeEqual`).
- The WebSocket upgrade passes the same guard, so the live socket accepts Bearer with no other change. The Node client sends the header on upgrade.

## CLI (`packages/cli/src/commands/`)

- `client.ts`: finds the lock and token in `TAU_HOME` (default `~/.tau`). When the pid is live but the URL is missing (startup), it retries for 5 s. Not running: "tau is not running. Run `tau` to start it." and exit 1.
- `parse.ts`: argv plus the table plus the schemas give the route input.
- `live.ts`: a Node WebSocket client for `subscribe`, `ops` and `changed` frames.
- `wait.ts`, `read.ts`: both use one text renderer, `protocol/src/view-text.ts` (user and assistant text, tool calls as one line each, notifications).
- `skill.ts`: prints the bundled SKILL.md.

## Core

- **Bash**: the registry installs `createBashTool({ prepare })` in place of the bundled bash. `prepare(execution, api)` sets `env.PATH = "<home>/bin" + ":" + process.env.PATH`, `env.TAU_HOME`, and `env.TAU_THREAD_ID = api.conversationId` (tools already read their thread this way: `list-agents.ts:39`).
- **Shim**: `createCore` gets `cliEntry`. Core writes `<home>/bin/tau` (mode 0755) with quoted paths: `exec "<process.execPath>" "<cliEntry>" "$@"`. The process that holds the home lock rewrites it at each startup, so an upgrade or a `pnpm dlx` run fixes it. A second launch that only prints "already running" never writes it.
- **Skill**: `core/src/skills/builtin/tau/SKILL.md`, scope `"app"`, after project and user skills; a project or user skill named `tau` wins.

## The skill (draft)

- tau runs your threads; `tau` is on PATH; `TAU_THREAD_ID` is your own thread.
- Start with `tau --help`; output is JSON; use `--wait` instead of polling.
- Recipes: work in another project (`projects list`, `threads start --wait`, `threads read`); check on other threads; merge a worktree or open a PR; change settings when the user asks.
- For your own subagents, use the `agent` tools, not the CLI.

## Protocol

- `commands.ts` (table and exclusions).
- `apply-view-ops.ts` moves from `web/src/conversation/` to `protocol` (it only imports `@earendil-works/chord/delta` and protocol types); web imports it from there.
- The busy and queue derivation (`docOf`, `queuedOf`, `LiveInfo`, from `web/src/conversation/model/live.ts`) moves to `protocol` too, so the CLI's wait condition 3 and the web read the queue the same way.
- `view-text.ts` (stub in Phase 0).
- `Skill.scope` += `"app"`.

## Web

- The `@` skill menu shows `app` skills with an "App" label.

## Phases and owners

0. **Foundation** (one agent): `commands.ts` with the complete table, the reducer and `live.ts` moves, the `view-text.ts` stub, `Skill.scope`, the Bearer guard and its tests, the bash `prepare` with a pin test (`TAU_THREAD_ID` is right in a main thread and in a subagent), the `cliEntry` plumbing (`run.ts` → `createCore` → `open.ts`), `cli-entry.ts`, `version` in the lock, and `main.ts` with `options.ts`: the one argv dispatch table (`serve`, the lifecycle words, `service`, `skill`, the table nouns), each routed to a stub handler in A's or C's folder. Nobody else edits `main.ts` or `options.ts`. Done when check, test and build pass.
1. Parallel:
   - **A: API commands** owns `packages/cli/src/commands/**` and `protocol/src/view-text.ts`.
   - **B: Core** owns `core/src/skills/**`, the shim, the skill text, and the web `@` label.
   - **C: Service** owns `packages/cli/src/service/**` (launchd, systemd, Task Scheduler, the detached fallback), `packages/cli/src/lifecycle/**` (bare `tau`, `start`, `stop`, `restart`, `status`, `open`, `logs`, `serve --service` waiting for the lock, the stored port), and `packages/cli/src/logging/**` (the server log file and its rotation).
2. **Integration**: merge all three, then e2e.
3. **Verify for real**: on macOS, `tau service install`, check that the app comes back after `launchctl kickstart -k` and after a logout and login (the user does the login step), then `tau service uninstall`. In the browser, ask an agent to start a thread in another project and report back. From Claude Code, run `tau threads list` and `tau threads read`.

## Testing

- Coverage: every JSON route is in the table or the exclusions; every positional and flag names a real schema field; every required body field is reachable.
- Parse: positionals, flags, `none`, `--no-x`, `--json`, query `force`; `serve --port 1` and the bare `tau` go to the right handlers.
- Server: Bearer accepted on REST and WebSocket, a wrong Bearer is 401 even with a valid cookie, Bearer plus a foreign Origin is 403.
- CLI: the lock without a URL then with one; not running; `--yes` and the own-thread refusal (parent chain); `--timeout` exit 3; `error` exit 1. `--wait` runs against the testkit fake core in three orders: idle then starts; already running, with the message queued behind the run; a child still running after the parent goes idle.
- `view-text.ts`: a snapshot test of the output format.
- Core: the shim is written, executable, and runs; a second launch does not rewrite it. A faux `bash echo $TAU_THREAD_ID` prints an id equal to the thread's id from `GET /conversations`, for a main thread and for a subagent. `app` skill precedence.
- Service: golden tests of the generated plist, unit, task XML and `.cmd` wrapper (PATH included). Install, uninstall, start, stop, restart and status call the right OS commands, in the right order, through an injected runner (`bootout` before `bootstrap`, linger after enable). A non-default `--home` gets its own service name. A changed node path triggers a reinstall; an npx-cache entry is refused. `serve --service` waits while a foreground server holds the lock and starts after it exits. The stored port is reused. Log rotation. Linux and Windows are tested only through the runner in this milestone.
- e2e (faux): `tau start --home <tmp> --faux` (detached mode, no service), `tau status --json`, `tau stop`. From a thread's bash, `tau projects list` and `tau threads start … --wait`; from a shell, `tau threads read`.
