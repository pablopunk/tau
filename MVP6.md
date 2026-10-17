# MVP6 plan: subagents like Claude Code

Status: APPROVED v3 (review rounds 1–2 applied). Builds on [MVP5.md](MVP5.md) (subagents, worktrees, processes).

## Goal

> The agent manages subagents the way Claude Code does: start them in the background, keep working, get notified with their report, message them, stop them, list them, pick an agent type and model, and give one its own worktree.

## Scope

In:
1. **Background subagents**: `agent` returns at once with the child id; each child answer is reported back to the parent as a notification (waking the parent if idle).
2. **Tools** (replacing `task` for the model): `agent`, `send_message`, `stop_agent`, `list_agents`.
3. **Agent types** from standard files: project `.pi/agents/*.md`, `.claude/agents/*.md`; user `~/.pi/agent/agents/*.md`, `~/.claude/agents/*.md`. No pi-everywhere config.
4. **Model override** per subagent.
5. **`isolation: "worktree"`**: the child gets its own worktree (MVP5 workspaces).
6. **UI**: agent card states, Stop on the card and child page, notification rows in the parent transcript, type label in the sidebar.

Out: nested subagents, the user chatting with a child directly, agent-type editing UI, hooks.

## Design basis: pi-durable example 23

Pi Durable documents this exact pattern (README L574-579, example `23-subagent-background`): "persistent subagents … spawns, messages (steer or follow-up), waits for, stops, and lists them. Each child is owned by a **background anchor task**, so the parent's Esc and idle waits never reach it. Each message is delivered by a **background reporter task** that posts the answer back to the parent as a follow-up input once it arrives; request IDs keep a restart from sending a message or a report twice." A task created with `{ background: true }` survives the parent's abort and does not keep the parent busy (L574). We follow it; Phase 0 reads the example in the pi-durable source (GitHub, or ask the maintainer's published repo) and pins the API calls.

## Tool API (what the model sees)

```ts
agent({ description: string, prompt: string, subagent_type?: string, model?: string, isolation?: "worktree", run_in_background?: boolean /* default true */ })
  → background: "Started subagent <id> (<description>). You will get a notification when it answers. Do not poll."
  → run_in_background: false: waits and returns the final report.
send_message({ to: string, message: string, mode?: "steer" | "followUp" /* default followUp */ })
  → delivers to that child (only this thread's children, via requireOwnChild); its next answer arrives as a notification.
stop_agent({ id: string })   → aborts the child's run; a "stopped" notification follows.
list_agents()                → this thread's children: id, description, type, model, status, last activity, worktree path.
```
- Descriptions follow Claude Code's wording: a subagent does not see the parent's chat, so prompts must be self-contained; wait for notifications instead of polling; never invent a result.
- `agent` is `replay: "unsafe"` and idempotent per tool call through the registry doc keyed by `toolCallId`.

## Core

- **Anchor + child** (as example 23, `packages/durable/test/examples/23-subagent-background.ts` in pi-mono): in one `api.commit`, `tx.createTask(Anchor, null, { ownership: { kind: "conversation" }, background: true })` (the anchor completes at once and stays the owner), `tx.createConversation({ ownership: { kind: "task", taskId: anchor } })`, our child doc + index entry (`parentId`, `background`, `agentType`, `model`), `configure(tx, child, { tools, instructions })`, and a registry doc entry keyed by `toolCallId`. The `agent` tool is `replay: "unsafe"` like the example; the commit first looks up the registry by `toolCallId` and returns the existing child, so a rerun never creates a second one (pin test: crash between commit and return).
- **Reporter**: every message to a child (`agent`'s first prompt, `send_message`) starts a background Reporter task that `submit`s to the child and `wait`s, then reports to the parent as an input submission with `whenBusy: "followUp"`, `requestId: subagent-report:<childId>:<childRequestId>`, and `entry: { kind: "app.subagent_notification", data: { childId, status, title, report } }` (custom `InputEntry`, harness types L28), with the text `<subagent-notification id status>…report…</subagent-notification>` for the model. One submission, so no separate write and no ordering race; the web renders entries of that kind as notification rows, and retry/title logic ignores them. Reported answers are recorded in the registry doc in the same commit (dedupe, as the example). A parent whose last run failed keeps the item queued until the user's next input (README L425); said in the tool description.
- **Status**: `running | done | failed | stopped`. `stop_agent` sets `stopRequested` in the registry, then aborts the child conversation (the child stays reusable, as the example); a reporter whose wait settles `aborted` reports `stopped` when the flag is set, else nothing. The parent's Esc does not stop children. Deleting/archiving the parent aborts each child conversation and archives/deletes it (per child, not `root.abort`).
- **Tool allow-list**: `configure(tx, child, { tools: [...registrations] })` (README L283-295; not `modelTools`). Children never get `agent`/`send_message`/`stop_agent`/`list_agents`.
- **Agent types** (`core/src/agents/`):
  - Frontmatter `name` (fallback filename), `description`, `tools` (comma string or YAML list), `disallowedTools`, `model`; body = a prompt section for the child. CRLF and multi-line values handled.
  - Precedence on name clash: project `.pi` > project `.claude` > user `.pi` > user `.claude`. Built-in `general-purpose` always exists. Cached 30 s (tests clear the cache).
  - Tool mapping: `Read`→`read`; `Write`→`write`; `Edit`/`MultiEdit`→`edit`; `Bash`→`bash`; `Grep`/`Glob`→`bash` (lossy: a type listing only Grep/Glob gets `bash`; documented); `WebSearch`→`web_search`; `WebFetch`→`fetch_content`; `TodoWrite`→`todo_write`; `mcp__*`→`mcp_search`+`mcp_call`; `Task`/`Agent`/`NotebookEdit` ignored. A type whose list maps to nothing is shown with an error in `list_agents` types and rejected on use.
  - Project types come from the repo; trusted like project `.mcp.json` (yolo).
- **Model**: `inherit` (default), `fast` (settings fast model), `provider/modelId` from the connected list, or an alias (`sonnet`, `opus`, `haiku`, any substring): candidates whose id contains it, prefer the parent's provider, then the highest version by natural sort descending; none → tool error listing options.
- **Worktree isolation**: `workspaces.create({ project, mode: "worktree", requestId: "agent:<toolCallId>", firstMessage: description })` before the commit; non-git project → tool error. The child's worktree is cleaned up by the existing removal hooks; deleting the parent cascades to children, and `unmergedWork` covers children.
- **Migration**: keep the `task` registration for replay but hide it from the model with `callers: ["tools"]` on the registration (applies to every conversation; `modelTools` is per conversation and would miss old ones). Phase 0 pin (e) proves an in-flight legacy `task` call still replays with that setting; if not, run a one-off `configure({ modelTools: { remove: [task] } })` over existing conversations at startup. The web keeps the `task` renderer.
- **Prompt section**: MVP5's subagents section updated (tool names, type, model).

## Protocol

- `ConversationSummary` += `agentType: string | null`, `agentModel: ModelRef | null`, `agentStatus: "running" | "done" | "failed" | "stopped" | null`, `background: boolean`.
- `Core.conversations.stopAgent(id)` + `POST /conversations/:id/stop-agent` (UI Stop; only for children; sets `stopRequested` then aborts). `list` already returns children.
- The input entry `app.subagent_notification` data shape is exported for the web.

## Web

- **Agent card** (`agent` calls; `task` cards keep working): description, type, model, status badge, Open link, Stop while running.
- **Notification row** for `app.subagent_notification` entries: "Subagent <title> finished/failed/stopped", expandable report, link to the child; the hidden marker input is not rendered.
- **Child page** header: type, model, status, Stop while running; still read-only.
- **Sidebar**: type label under child titles when not `general-purpose`.

## Testing

- Phase 0 pins (pass/fail tests): (a) the child keeps running after `agent` returns; (b) parent Esc/abort does not stop it; (c) parent shows idle while the child runs; (d) hub restart mid-child resumes child and reporter, and the report is posted exactly once; (e) in-flight legacy `task` call replays after upgrade.
- Contract tag `subagents` extended: background start, notification lands (write entry + input), send_message steer/followUp, stop → stopped, list, types from a fixture `.claude/agents`, model alias, worktree isolation, non-git isolation error. The faux provider can hold a child mid-run for steer/stop cases.
- Core: frontmatter parser, mapping table, precedence, alias resolution determinism.
- e2e (faux): two background subagents, parent continues, both notification rows appear, stop one, open a child.
- Real run: two background subagents with the OpenRouter key on a temp repo.

## Parallel work

### Phase 0 (one agent)
Pins (a)–(e) plus (f) crash between the `agent` commit and its return creates no second child, and (g) a restart during reporting posts exactly one notification; protocol fields, route, fake core, contract cases (pending); core stubs for `core/src/agents/**` and the four tool files; registry wiring incl. hidden legacy `task`; removal cascade for children; owns `registry.ts`, `create-core.ts`, protocol, server, testkit.

### Phase 1 (3 agents)
| Agent | Owns |
|---|---|
| A tools + anchor/reporter | `core/src/harness/tools/{agent,send-message,stop-agent,list-agents}*`, `core/src/harness/subagent*` (incl. `subagents-prompt.ts`), `core/src/harness/tools/task*` (legacy) |
| B agent types + models + isolation | `core/src/agents/**` |
| C web | `web/src/conversation/tools/AgentTool*`, `web/src/conversation/notifications/**`, `web/src/sidebar/subagents/**`, child page header, `web/src/lib/**` additions for stop-agent |

### Phase 2: integration, e2e, real run in the browser.
