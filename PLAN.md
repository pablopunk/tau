# Tau — plan

Working name. Goal: my own app to run Pi agents on my machines and use them from my phone, laptop, or any other device, with a UI organized the way I like.

## Decisions

### Agent
- Pi is the only harness. No support for other harnesses (OpenCode, Codex, …).
- Core is **Pi Durable** (`@earendil-works/pi-durable`): crash recovery, many conversations, many clients attached to one conversation, forks.
- Pi Durable is experimental, so we wrap it in one thin module of our own. API changes stay in that module.

### Nodes
- **Every tau is a node.** There is no hub and no runtime: each node owns its own projects, threads, settings and files, and runs its own agents and terminals.
- **A thread lives on one node** and runs there. Another node shows it and works on it through the link; it does not move.
- **Links are symmetric.** `tau connect <link>` (or `tau connect <code> --node <url>`) on either node links the two; afterwards each sees the other's threads in its sidebar and in Settings → Nodes, can open threads and terminals on it, and `tau disconnect` removes the link on both sides. A node has an Ed25519 identity (`<home>/node.json`); its `nodeId` is the hash of its public key, so an id cannot be claimed with another key.
- **Full power in all directions.** A link gives each node the owner's power on the other (threads, terminals, files, Claude login). Link only nodes you own. There are no scopes yet.
- **A node that cannot run threads yet** (no provider) can skip onboarding with "Use my other nodes" when it knows a peer, and work on the peers' threads.
- **Declare a project once per node**, keyed by its git remote. A node clones the repo when it first needs it, keeps a local cache, and gives each conversation its own git worktree.
- **Later (MVP13 Step 2, see `MVP13.md`):** nodes announce themselves along the links, so A sees C through B (routing), and any node can remove a node from the whole group (signed expulsion).

### Access
- Any node can be reachable from outside through OpenTunnel (https://opentunnel.xyz/) persistent URL, zero-config (no account, no domain, no DNS). E2E encrypted, relay never sees plaintext. A node that only dials out needs no tunnel and no open ports.
- Device pairing (QR code + approval) like webr and opencode: `tau pair --remote` prints a QR with a one-time code (single use, expires in minutes); the phone app or browser opens it and the node approves the device. Disabling remote burns the URL and minting a new one on re-enable.

### Client
- Web app installable to the home screen (PWA), like webr. Same app on phone and laptop.
- **The app is URL-based.** Every view the user can reach has its own URL (`/p/<project>/c/<thread>`, `/new?project=…`). Back and forward work, a reload keeps the view, and a link opens the same view. New views get a URL first, not hidden UI state.

### Built-in terminal
- The app has a real terminal on any node, so setup never says "SSH into your server" (e.g. `claude` login, installing tools).
- Setup steps that need a shell open this terminal with the command already typed.
- Reuse webr's terminal (xterm, touch key bar), but the PTY lives in our daemon, not Herdr.

### Stack
- Same as webr: TypeScript, Node, SQLite, React.
- Reuse webr parts where they fit: pairing, sidebar, mobile UI.

### Modularity
- No plugin system of our own. Agent features are **Pi Durable extensions** (e.g. compaction ideas, Claude Code compatibility).
- UI features are normal app code.
- Each extension can be turned on or off in settings.

### Settings
- Global settings are the default.
- Every setting can be overridden per project.

### Claude Code compatibility (optional extension)
- Match Claude Code behavior as much as possible: hooks, rules, CLAUDE.md, custom agents, skills, directories.
- Hook mapping (to check): PreToolUse → tool call hook, PostToolUse → tool result hook, UserPromptSubmit → input hook, Stop → end-of-run hook, SessionStart/End → session events.

What the work plugins (`~/src/maze/claude-plugins`, 27 plugins) actually need:
- **Plugin loading**: `.claude-plugin/plugin.json` (name, version, `dependencies`), marketplace install, `${CLAUDE_PLUGIN_ROOT}`.
- **Shell hooks** (`hooks/hooks.json`, all `type: command`), by use:
  - Events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStop`.
  - Matchers are regexes on tool names: `Bash`, `Read`, `Write|Edit|MultiEdit`, `Skill|Agent|Task`, `AskUserQuestion`, `SendMessage`, `ExitPlanMode`, MCP names, `^ship:`.
  - JSON input on stdin; JSON output fields: `decision`/`reason` (most used), `hookSpecificOutput.permissionDecision` + `permissionDecisionReason`, `additionalContext`, `systemMessage`, `updatedInput`, `continue`.
  - Env vars: `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, `CLAUDE_SESSION_ID`/`CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`.
- **TypeScript hook modules** ("mods", `hooks.json` → `"modules": ["./register.ts"]`, e.g. `scoped-skill-injection`): in-process API with `session`, `fs`, `process`, `ui.log`, `state`. Newer and rarer, but required by the `ship` captain: most of its gates (crew-read, gh, monitor-arm, memory-lint, jurisdiction, ticket-recheck) are mods in `ship/hooks/register.ts`.
- **Per-thread settings overlay**: `ship` starts each crew member with a settings override (plugins off, tools denied). Model it as a generic per-thread toggle on top of the per-project settings, not a ship-specific flag.
- **Skills** (23 plugins): `SKILL.md` frontmatter `name`, `description`, `argument-hint`, `allowed-tools` (incl. `Bash(cmd:*)` patterns), `disable-model-invocation`, `context: fork`, `agent:`.
- **Agents** (8 plugins): `agents/*.md` frontmatter `name`, `description`, `model`, `effort`, `tools`, `skills`.
- **Commands**, **output styles**, **`bin/`** on PATH.
- **Tools the hooks expect by name**: Bash, Read, Write, Edit, MultiEdit, Skill, Agent/Task, AskUserQuestion, SendMessage, ExitPlanMode, PushNotification. Pi tool names differ, so the extension needs a name map (or aliases) for matchers and tool input shapes.
- **CLAUDE.md** chain (user, project, `@imports`) and settings permissions.
- **Waking the agent** (the captain skill in `ship/` relies on all of these):
  - `Monitor`: a background command whose every stdout line wakes the agent (`crew monitor` prints `TICK`/`DAY-START`/activity lines).
  - `Bash` with `run_in_background`: wakes the agent when the command exits.
  - `ScheduleWakeup` / `CronCreate`: timers that send a prompt later.
  - `SendMessage`: one session messages another.
  - `tmux send-keys`: types into another agent's terminal (crew adapter).
  - `claude -p` / `claude --resume`: headless runs.
  - Pi Durable fits this well: background tasks, timers that survive restarts, and "any client can queue a message" are built in. We need one API ("send a message to conversation X") that a node exposes to tools, CLIs, and other conversations.

### MCP and claude.ai connectors (exploration)
- Regular MCP servers (stdio or HTTP, from `.mcp.json`) are easy: the node runs them as tools.
- claude.ai connectors go through an Anthropic-hosted proxy with Claude Code's own OAuth token. We want to reuse the Claude Code session, auth and connectors. Options, none chosen yet:
  - **Reverse engineer the proxy**: find how Claude Code lists connectors and calls them, then replay it with the token. Likely doable, but it is the same token reuse Anthropic does not allow outside Claude Code (rejected for model calls above), so it risks the account.
  - **Drive the real interactive `claude` in a PTY on the node**: reuses session, auth, connectors and hooks natively; read the transcript files in `~/.claude/projects` to render the chat. Cost: those conversations run on Claude Code, not Pi Durable (no durable timers, `submit()` or forks for them).
  - **Each service's own MCP endpoint with our own OAuth** (Linear, Notion, Figma, Slack, Datadog): no Anthropic involved. Covers only services with a public endpoint. Needs MCP OAuth support in our MCP client (not built yet; MVP5 has stdio and plain HTTP only).
  - **Not used**: `claude -p` / Agent SDK. It may bill at API rates (to verify); this would also hit the "Claude Code as a provider" idea in the setup checklist.

### First run (setup checklist)
The first screen is a checklist of what the user must do before the app works:
1. **Projects folder**: a default hidden folder that touches none of the user's folders (e.g. `~/.tau/projects`), or a custom folder they choose. It also holds the worktrees of the threads.
2. **At least one AI provider**:
   - API key (e.g. OpenRouter): paste the key.
   - Subscription login (e.g. OpenAI/ChatGPT, OpenCode/OpenCode Go): use each provider's own login flow, through Pi's provider auth where it exists.
   - Claude Code: reuse the `claude` CLI that is already installed and logged in. If it is missing, tell the user to install it and log in. Probably a Pi extension (custom provider).
     - Model calls run on the thread's node, so `claude` must be logged in **on that node**: install it there and log in once over SSH (`claude`, then `/login`; it prints a link to open on any device). `claude setup-token` is only a fallback for machines with no interactive login.
     - The provider drives the `claude` CLI; it never sends the subscription token straight to the API (Anthropic does not allow that outside Claude Code).
     - Rejected: copying the laptop's saved login to the server (both machines refresh the same token and log each other out). Later option: route Claude calls through a node that has `claude` logged in.
3. **Models**, after a provider is set:
   - **Default model** (required).
   - **Fast model**: for AI features in the app (naming sessions, choosing the project automatically, …).
   - **Image model**: a model that accepts image input, used when the default model can't read the images in a chat.
   - **Voice model** (maybe): speech-to-text through an API (e.g. OpenRouter) or a local model loaded when the mic button is pressed (like webr's Parakeet).

## Pi Durable check (read the code, commit `95364a5`, 2026-10-16)
Confirmed:
- **Many clients on one conversation**: `conversation.watch()` sends each commit's exact changes; a client that joins late or reconnects gets the current view (`21-late-join.ts`). `watchEvents()` gives coding-agent style events if we prefer them.
- **Messages from anywhere**: `submit()` with `whenBusy: "steer" | "follow-up"`, an inbox, and `requestId` for exactly-once. This is our "send a message to conversation X" API.
- **Tools on another machine**: the `env` function builds an `ExecutionEnv` per call from the conversation's `cwd`/ID (`29-sandbox-per-conversation.ts`).
- **`@earendil-works/pi-env` already exists**: a small Rust daemon (`pi-env serve`) for Linux/macOS/Windows/Termux that does file operations, commands, file listing, and **real terminals (PTY)** on a remote machine. `RemoteExecutionEnv` is the matching `ExecutionEnv`.
- Plus: background tasks, durable timers, subagents (foreground and background), plan mode as an extension, per-conversation agent, compaction hooks, SQLite storage.

Gap:
- pi-env's `Connection` starts the daemon as a child process (normally over `ssh`) and talks over its stdin/stdout. Not used today (threads run on their own node). If a thread's tools should ever run on another node, we need a bridge over the link: that node starts `pi-env serve` locally and pipes its frames over the link's WebSocket; on the thread's node, the `Connection` command is a tiny local program that relays to it (or we add a stream option to `Connection` upstream).
- So that bridge would be **pi-env + a WebSocket bridge + repo checkout/worktrees**. Terminals come for free through `openTerminal()`.

Not used: existing Pi CLI extensions and skills (different model; port when needed).

Not used: `@earendil-works/pi-web-ui`. Last release 0.75.3 (May 2026), no longer in the Pi repo at 1.0, built on Lit/mini-lit web components (not React/shadcn), depends on pi-ai 0.75, and knows nothing about Pi Durable.

## MVP (end to end, smallest possible)
Goal: install → connect a provider → add a project → an agent changes something in it.
1. **Install**: `npx <name>` starts one Node process on `localhost` and opens the browser. No auth (localhost only), no tunnel, no linked nodes.
2. **Provider**: one screen to paste an **OpenRouter** API key, then pick the default model from OpenRouter's list. Stored in a settings file.
3. **Project**: paste a folder path. No git cloning, no worktrees; the agent works in that folder.
4. **Chat**: one page per project with a list of conversations and a chat view (messages, tool calls with output, send, stop). Live updates through `conversation.watch()` over one WebSocket.
5. **Agent**: Pi Durable + SQLite + `CodingTools` (read, write, edit, bash), `NodeExecutionEnv` with `cwd` = project folder. No other extensions.

6. **UI**: React + Vite app served by the same process, built on **shadcn/ui** (Tailwind, Radix) from day one, with our own theme tokens. Two screens: setup (key + model) and main (sidebar with projects → conversations, chat view with composer and stop).
**Quality bar**: the MVP is the start of the real product, not a proof of concept. Small scope, but every part is built to last: design system, clean module seams, tests, no "fix it later" code.

Out of the MVP: tunnels, pairing, linked nodes, terminals, other providers, fast/image/voice models, settings per project, Claude Code extension, PWA polish.

## First version (proposal)
1. Node: Pi Durable + SQLite + `CodingTools`, one API-key provider, this machine as its only node (`NodeExecutionEnv`).
2. Web app (PWA): project list, conversation list, chat view from `watch()`, send/steer/abort.
3. Pairing + OpenTunnel remote access (`tau pair --remote`: persistent URL + QR, one-time codes, server password behind it).
4. Then: linked nodes (MVP12-13), built-in terminal, setup checklist, more providers, Claude Code extension.

## Later
- **Model tiers** in Settings → Models: "smart" (the main thread) and "worker" (subagents), so the parent picks workers without being told in the chat. Keep the Models section uncluttered when adding it.
- **Project view** (next): "Open project" in a project's context menu goes to a project URL (for example `/p/<project>`). There the sidebar shows only that project's threads, and "New thread" starts in that project. The browser Back button and a "All projects" link go back to the full sidebar. A thread opened from the project view keeps the project URL scope.
- **Claude CLI provider** (next, MVP9; personal use only): detect the user's own logged-in `claude` CLI (`claude auth status --json`) and show it in Settings → Providers as connected (like shell env keys); same model list as Claude Code's `/model` (Agent SDK `supportedModels()`); run threads through the Agent SDK so usage counts against the subscription. Validated (see `scratchpad/claude-sdk-spike/notes.md`): subscription billing, models, streaming, tools, resume all work. Conditions: never touch tokens, never offer the login to other users, always disable claude.ai connectors (`strictMcpConfig`), pin the SDK, show rate-limit info. Later: more Claude Code features (hooks, plugins, skills); **Claude CLI on another node**: now that taus link as nodes, a thread on one node can use the `claude` login of a linked node (e.g. the MacBook), with the SDK process running there.
- **PWA, offline and data caching** (planned). Priority: every user action feels instant — optimistic UI first, server confirmation after. No spinner waits on send, archive, retitle, navigation or pane switches.
  - Optimistic mutations everywhere: apply locally on tap, roll back with a toast on failure (React Query `onMutate`/`onError`). The composer sends on keypress, not on round-trip.
  - Installable app: web manifest with the tau icon, icons for iOS and Android, theme and background colors, standalone display, add-to-home-screen hint.
  - Service worker: precache the app shell; stale-while-revalidate for shell assets, network-first for `/api` (never serve stale API data), and a clear offline state when the server is unreachable. No caching of WS frames or transcripts — the live socket stays the source of truth.
  - React Query as the SWR layer (today everything refetches with `staleTime: 0`): per-kind `staleTime`/`gcTime` — static lists (providers, models, projects, skills) stale for minutes, conversation lists for seconds; `changed` WS events stay the invalidation signal and reconnect refetches REST as today; `keepPreviousData` on navigation so back/forward never flashes.
  - Offline queue: mutations made offline (send, title edit, archive) queue locally and replay on reconnect; composer drafts already survive in localStorage.
  - Push notifications when a run ends are part of "Push to the user".
  - Perf budgets: route-level code splitting (settings, setup, dialogs lazy), xterm and pane renderers lazy-imported (webr does this), a virtualized transcript for long threads, attachment/image memory budgets (webr's multi-pane lesson).
  - A mobile layout that feels native: the sidebar as a sheet, a bottom-aligned composer that follows the keyboard (`visualViewport`, safe-area insets), large touch targets, swipe to open the sidebar, readable transcript and tool cards at 360px, settings as full-screen pages, no horizontal scroll anywhere. Check every screen at phone width, and test installed on iOS and Android.
- **Chat with a subagent directly**: open the child thread's composer instead of going through the parent.
- **Timers and loops** (planned): the agent schedules a wake-up ("check CI in 10 minutes"), recurring prompts, and a `/loop` mode. Pi Durable timers survive restarts.
- **Monitor** (planned): a background command whose output lines or exit wake the agent; processes notify the agent when they exit.
- **Workflows** (planned): scripted orchestration of many subagents (pipelines, parallel review rounds), on top of MVP6 subagents.
- **Push to the user** (future): the agent pings the phone and sends files.
- **Thread panes** (explore, webr-style strip): each thread keeps the transcript plus agent-controlled generic panes in a horizontal strip (2 visible, rest collapsed to the edges, tabs below 760px). A pane holds a terminal (PTY on the thread's node), a browser (HTML served by the server, e.g. agent-built pages or links, rendered with the app's shadcn components), a file tree (the node's checkout rooted at the thread's worktree), an editor (view/edit a file from the tree, edits go through the same file layer as agent writes), or a diff (thread's uncommitted changes, or any commit/range the agent pins) — instead of artifacts. The agent and the user both control panes: the agent opens, closes, focuses and writes to them through tools; the user does the same from the UI. Opening a file from the tree or a hunk from the diff focuses the editor at that line; the editor's save is just another write to the same worktree the agent works in.
- **Explore**: PDF and notebook reading; moving a running thread between the main checkout and a worktree.
- **Thread runtime** (planned): every conversation gets its own worktree (see "Nodes" above), but nothing caps what runs there today, and several conversations each running tests or builds at once can saturate one node's CPU and RAM. One chokepoint already exists for this: `launch()` in `packages/core/src/processes/process-service.ts` is called by both `start()` (background processes, monitors) and `runForeground()` (the bash tool), and it calls `spawnRunning()` (`packages/core/src/processes/running-process.ts`), a plain `child_process.spawn`. Make the runtime pluggable there, the same shape as `WorkspaceMode`: a `runtime` setting (`local` default, more added over time), overridable per project the same way `lastWorkspaceModes` is keyed by `projectId` in `settings-store.ts` today.
  - **`local`** (default, today's behavior, kept as the zero-setup tier): no isolation, optionally a soft governor — lower scheduling priority (`nice`, Darwin's background band) by default, an opt-in hard CPU cap via SIGSTOP/SIGCONT duty-cycling on the process group, RSS polling for memory with a breach reusing the stop path `run.stop()` already has. No credential re-plumbing since nothing is isolated, only throttled; same technique as `with-limits`/`scaler`.
  - **`orbstack`** (first real backend): one container per worktree, hard cgroup-enforced `--cpus`/`--memory` caps — real enforcement because OrbStack runs an actual Linux VM, unlike bare macOS. Container lifecycle rides the worktree's: create alongside `addWorktree()` in `workspaces/worktree-create.ts`, tear down alongside `removeWorktreeAndBranch()` in `workspaces/worktree-remove.ts`. `spawnRunning` becomes `docker exec` into that worktree's container instead of a host spawn. Cost this backend actually carries: credentials (SSH agent socket, cloud SSO, kubeconfig, 1Password session) need mounting into the container once at creation, and a shared cache volume (e.g. the pnpm store) per repo keeps every worktree from re-downloading dependencies.
  - **Later backends**, same interface: Daytona or Coder (moves execution off the node entirely, trades isolation for network latency and a credential boundary question), Apple's `container` CLI.
  - Open: is `runtime` a per-project setting (a repo that needs Neo4j/Redis sidecars always gets `orbstack`) or per-conversation (user picks isolation only for the heavy thread)? Does `local`'s cap apply per-conversation or pool across every conversation on the node?

## Open questions
- How to use the work Claude subscription through Pi.
- Projects with no git remote (local-only folders).
- Pi Durable extensions are a different model from Pi CLI extensions; existing Pi extensions and skills may need a port.

## References
- Pi: https://pi.dev — repo https://github.com/earendil-works/pi
- Pi Durable: https://earendil.com/posts/pi-durable/ — `packages/durable/README.md`
- T3 Code: https://github.com/pingdotgg/t3code (server owns everything, event log, scoped auth, T3 Connect relay)
- Multica: https://github.com/multica-ai/multica (hub + runtime daemons, repo cache + worktree per task; tau chose symmetric nodes instead)
- webr: `~/src/webr` (my current tool, Herdr backend)
