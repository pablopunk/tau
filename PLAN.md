# Pi Everywhere — plan

Working name. Goal: my own app to run Pi agents on my machines and use them from my phone, laptop, or any other device, with a UI organized the way I like.

## Decisions

### Agent
- Pi is the only harness. No support for other harnesses (OpenCode, Codex, …).
- Core is **Pi Durable** (`@earendil-works/pi-durable`): crash recovery, many conversations, many clients attached to one conversation, forks.
- Pi Durable is experimental, so we wrap it in one thin module of our own. API changes stay in that module.

### Machines
- **Hub + runtimes** (like Multica):
  - The hub (my server) owns all data: projects, conversations, settings.
  - A runtime daemon runs on each machine (server, laptop). It runs the tools (read, write, edit, bash) for a conversation, through Pi Durable's execution-environment interface.
  - A conversation continues on any online runtime, so the laptop does not need to be on to continue a chat.
- Files live on the runtime that does the work, not on the hub.
- **Declare a project once**, on the hub, keyed by its git remote. Each runtime clones the repo when it first needs it, keeps a local cache, and gives each conversation its own git worktree.

### Access
- Only the hub is reachable from outside: Cloudflare Tunnel on my own domain.
- Runtimes connect out to the hub. They need no tunnel and no open ports.
- Device pairing (QR code + approval) like webr.

### Client
- Web app installable to the home screen (PWA), like webr. Same app on phone and laptop.

### Built-in terminal
- The app has a real terminal on any machine (hub or runtime), so setup never says "SSH into your server" (e.g. `claude` login, installing tools).
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
- **TypeScript hook modules** ("mods", `hooks.json` → `"modules": ["./register.ts"]`, e.g. `scoped-skill-injection`): in-process API with `session`, `fs`, `process`, `ui.log`, `state`. Lower priority, newer and rarer.
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
  - Pi Durable fits this well: background tasks, timers that survive restarts, and "any client can queue a message" are built in. We need one API ("send a message to conversation X") that the hub exposes to tools, CLIs, and other conversations.

### First run (setup checklist)
The first screen is a checklist of what the user must do before the app works:
1. **Projects folder**: a default hidden folder that touches none of the user's folders (e.g. `~/.pi-everywhere/projects`), or a custom folder they choose. It also holds the worktrees of the threads.
2. **At least one AI provider**:
   - API key (e.g. OpenRouter): paste the key.
   - Subscription login (e.g. OpenAI/ChatGPT, OpenCode/OpenCode Go): use each provider's own login flow, through Pi's provider auth where it exists.
   - Claude Code: reuse the `claude` CLI that is already installed and logged in. If it is missing, tell the user to install it and log in. Probably a Pi extension (custom provider).
     - Model calls run on the hub, so `claude` must be logged in **on the hub**: install it there and log in once over SSH (`claude`, then `/login`; it prints a link to open on any device). `claude setup-token` is only a fallback for machines with no interactive login.
     - The provider drives the `claude` CLI; it never sends the subscription token straight to the API (Anthropic does not allow that outside Claude Code).
     - Rejected: copying the laptop's saved login to the server (both machines refresh the same token and log each other out). Later option: route Claude calls through a runtime that has `claude` logged in.
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
- pi-env's `Connection` starts the daemon as a child process (normally over `ssh`) and talks over its stdin/stdout. Our runtimes dial out to the hub, so we need a bridge: the runtime starts `pi-env serve` locally and pipes its frames over its WebSocket to the hub; on the hub, the `Connection` command is a tiny local program that relays to that WebSocket (or we add a stream option to `Connection` upstream).
- So the **runtime daemon = pi-env + a WebSocket bridge + repo checkout/worktrees**. Terminals come for free through `openTerminal()`.

Not used: existing Pi CLI extensions and skills (different model; port when needed).

Not used: `@earendil-works/pi-web-ui`. Last release 0.75.3 (May 2026), no longer in the Pi repo at 1.0, built on Lit/mini-lit web components (not React/shadcn), depends on pi-ai 0.75, and knows nothing about Pi Durable.

## MVP (end to end, smallest possible)
Goal: install → connect a provider → add a project → an agent changes something in it.
1. **Install**: `npx <name>` starts one Node process on `localhost` and opens the browser. No auth (localhost only), no tunnel, no runtimes.
2. **Provider**: one screen to paste an **OpenRouter** API key, then pick the default model from OpenRouter's list. Stored in a settings file.
3. **Project**: paste a folder path. No git cloning, no worktrees; the agent works in that folder.
4. **Chat**: one page per project with a list of conversations and a chat view (messages, tool calls with output, send, stop). Live updates through `conversation.watch()` over one WebSocket.
5. **Agent**: Pi Durable + SQLite + `CodingTools` (read, write, edit, bash), `NodeExecutionEnv` with `cwd` = project folder. No other extensions.

6. **UI**: React + Vite app served by the same process, built on **shadcn/ui** (Tailwind, Radix) from day one, with our own theme tokens. Two screens: setup (key + model) and main (sidebar with projects → conversations, chat view with composer and stop).
**Quality bar**: the MVP is the start of the real product, not a proof of concept. Small scope, but every part is built to last: design system, clean module seams, tests, no "fix it later" code.

Out of the MVP: tunnels, pairing, remote runtimes, terminals, other providers, fast/image/voice models, settings per project, Claude Code extension, PWA polish.

## First version (proposal)
1. Hub: Pi Durable + SQLite + `CodingTools`, one API-key provider, the hub machine as its only runtime (`NodeExecutionEnv`).
2. Web app (PWA): project list, conversation list, chat view from `watch()`, send/steer/abort.
3. Pairing + Cloudflare Tunnel.
4. Then: remote runtime (pi-env over the WebSocket bridge), built-in terminal, setup checklist, more providers, Claude Code extension.

## Open questions
- How to use the work Claude subscription through Pi.
- Projects with no git remote (local-only folders).
- Pi Durable extensions are a different model from Pi CLI extensions; existing Pi extensions and skills may need a port.

## References
- Pi: https://pi.dev — repo https://github.com/earendil-works/pi
- Pi Durable: https://earendil.com/posts/pi-durable/ — `packages/durable/README.md`
- T3 Code: https://github.com/pingdotgg/t3code (server owns everything, event log, scoped auth, T3 Connect relay)
- Multica: https://github.com/multica-ai/multica (hub + runtime daemons, repo cache + worktree per task)
- webr: `~/src/webr` (my current tool, Herdr backend)
