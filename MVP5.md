# MVP5 plan

Status: APPROVED v4 (review rounds 1–3 and user decisions applied). Builds on [MVP4.md](MVP4.md) and earlier plans (architecture, security, testing and parallel-work rules still apply).

## Goal

> A very good harness: threads in their own worktrees that merge back with one click, undo per turn, fork, subagents I can open from the sidebar, web search with no setup, todos, MCP, background processes, and a choice between steering and queueing. Always yolo: no approval prompts.

## Scope

In:
1. **Worktrees**: a thread starts in "New worktree" (default) or "Main checkout". One-click "Merge into `<base>`", "Create PR", "Remove worktree".
2. **Checkpoints**: a snapshot of the working tree per turn; per-turn changed files with diffs; "Rewind to here" on a user message.
3. **Fork**: "Fork from here" on any message.
4. **Steer or queue**: a setting for messages sent while the agent works; queued messages can be cancelled.
5. **Subagents**: a native `task` tool; subagent threads appear indented under their parent in the sidebar and open read-only.
6. **Web**: `web_search` and `web_fetch`, zero config.
7. **Todos**: a `todo_write` tool and a checklist above the composer.
8. **MCP**: servers added in Settings and from a project's standard `.mcp.json`.
9. **Background processes**: start, logs, stop; a processes panel per thread.

Out: approvals (always yolo), pi-coding-agent extension compatibility, worktree setup (copying files, install scripts), worktrees for non-git projects, MCP OAuth, port forwarding of dev servers to the phone.

## Product decisions (user)

- **No pi-everywhere config files in repos, ever.** No `.pi-everywhere/`, no `.worktreeinclude`. A new worktree is just `git worktree add`; the agent figures out installs itself.
- **Subagents are our own extension** so children are real threads we can list and open.
- **Web search works out of the box**, no key.
- **MCP from a project's `.mcp.json` is always trusted** (yolo), like the rest.
- **One milestone**, all nine items.

## Product decisions (design)

- **No pi-coding-agent extensions.** Every candidate (`pi-subagents`, `pi-web-access`, `rpiv-todo`, `pi-mcp-adapter`, `pi-background-tasks`) targets pi-coding-agent's `ExtensionAPI`; Pi Durable 1.3.0 has no adapter. We write small native extensions and copy their tool schemas.
- **Worktrees** live at `<home>/worktrees/<repo>/<slug>` on branch `pi/<slug>` (slug `[a-z0-9-]`, max 40, from the first message; unique against existing refs and worktree dirs). Base = the main checkout's current branch at start. For a project that is a subfolder of a repo, the worktree is of the repo root and the thread's cwd is `<worktree>/<subpath>`. Only for projects inside a git repo; others (and Home) always use the folder.
- **Merge into base** (one button):
  1. Rejected with `thread_busy` while the thread runs; one workspace operation at a time per repo (lock).
  2. Needs a clean worktree, else `worktree_dirty` and the UI offers "Ask agent to commit" (a canned message).
  3. In the worktree: `git rebase <base>`; on conflict `git rebase --abort`, `merge_conflict`, and the UI offers "Ask agent to resolve" (canned message: rebase onto base, fix conflicts, continue).
  4. In the main checkout: must be on `base` (else `not_on_base`); `git merge --ff-only pi/<slug>`; git refuses when local changes would be overwritten → `base_dirty` with git's message. If base moved meanwhile, repeat from 3 once.
  5. Record `mergedSha`; state `merged`.
- **Remove worktree**: `git worktree remove` then `git branch -d` (`-D` only if `merge-base --is-ancestor <branch> <base>`). With uncommitted changes or unmerged commits → `has_unmerged_work` unless `force` (the confirm names the files/commits). The thread then moves to the main checkout path and stays usable.
- **Archive** keeps the worktree. **Delete thread** and **delete project** run the same guard (`has_unmerged_work` unless forced) and then remove worktree, branch, checkpoint refs, process logs.
- **Create PR** (when `gh` is connected): `git push -u origin pi/<slug>`, `gh pr create --fill --head pi/<slug>`; store and show the URL.
- **Checkpoints**:
  - Taken in core, not in harness hooks: one "before" snapshot when a message is submitted (keyed by its `requestId`), one "after" snapshot when the run ends (status tracker). Each checkpoint records `{ requestId, entryId?, sha, at }` in a small app doc `scope: "conversation", history: "rewindable", fork: "asOf"` so forks keep their history. A user entry carries no `requestId`; its `SubmissionRecord` does and gets `entry` once `status: "placed"` (`types.d.ts:329-350`), so `entryId` is filled when the submission is placed (null while queued); "Rewind to here" looks checkpoints up by `entryId`.
  - Snapshot = `git add -A -- :/` with a persistent per-thread index `<home>/checkpoints/<conversationId>.index` (`GIT_INDEX_FILE`), `write-tree`, `commit-tree`, ref `refs/pi-everywhere/<conversationId>/<n>`. Always from the repo top level, so subfolder projects are safe. The user's index, stash and branches are untouched. Ignored files are not captured.
  - Per-turn changes = `git diff --numstat` between consecutive checkpoints of the thread.
  - Restore to checkpoint C: take a fresh snapshot S; the paths to change are `git diff --name-status -z --no-renames C S`; for each path write C's blob with its mode (100644/100755), recreate symlinks (120000) with `symlink`, skip gitlinks (160000), or delete the file (status `A`). Verified exact in review (untracked, renamed, deleted, spaces, exec bit, nested dir, ignored untouched). Empty dirs may stay. Never touches ignored files, nested repos or anything outside the repo; the confirm dialog shows that exact list first. The temp index lives outside the repo (`<home>/checkpoints`).
  - Refs and the index file are deleted with the thread (on the project repo, even after worktree removal).
- **Rewind to here** (user message): rejected with `thread_busy` if any thread with the same cwd is running; restores files to that message's "before" checkpoint, forks the conversation just before the message into a new thread in the same checkout/worktree, and puts the message text in the new thread's composer. The UI warns that ignored files (e.g. `node_modules`) and effects outside the repo are not undone.
- **Fork from here**: `parent.fork(entryId, { ownership: { kind: "ownerless" }, init })`; `init` writes our conversation doc and index entry in the same commit. Pi keeps the parent's agent (cwd, model) as of that entry. Shares the checkout/worktree with the source; title "Fork of …".
- **Steer or queue**: Settings → Agent: "While the agent works, new messages: Steer (default) / Queue" → `whenBusy: "steer" | "followUp"` (pi-durable `SubmissionDraft`). `Alt+Enter` sends with the other mode once. Queued items show a cancel button → `Submissions.abort`; an item already delivered returns `{ cancelled: false }`.
- **Subagents**: our `task({ description, prompt })` tool, following pi-durable's documented pattern (README "subagents"): `tx.createConversation({ ownership: { kind: "task", taskId } })`, idempotent lookup via `scanConversations({ ownerTaskId })`, `replay: "safe"`, `executionMode: "parallel"`. The child gets the parent's agent (cwd, model, thinking) and the tools minus `task` (no nesting). The child's `ConversationDoc` (projectId, title = description) and its index entry `{ parentId }` are written in the tool's own `tx` right after `tx.createConversation({ ownership })` (raw `tx.createConversation` has no `init`; same commit), so `known()` finds it; the idempotent rerun path (found by `scanConversations({ ownerTaskId })`) skips the write. It appears **indented under its parent in the sidebar** (both modes), with the live status avatar; clicking opens the child transcript read-only (no composer). The `task` card links to it too. Children are archived/deleted with their parent.
- **Web search** (zero config, no setting): `web_search` uses a connected provider's own search, chosen at call time: the thread's provider first, then any other connected one, in this order: OpenRouter (`plugins: [{ id: "web", max_results: 5 }]` on a cheap model; verified in review: `choices[0].message.annotations[].url_citation` gives `url`, `title`, `content` (use as snippet; `start_index`/`end_index` are 0)), OpenAI (Responses `web_search` tool), Anthropic (`web_search` server tool), Google (`google_search` grounding). Each backend is one file returning `{ title, url, snippet }[]`. Last resort: DuckDuckGo's HTML endpoint via POST (`result__a`, decode `uddg=`); HTTP 202 or an "anomaly" page is a failure (it rate-limits after ~4 requests, verified in review), reported to the agent as "search unavailable, try web_fetch on a known URL". Phase 0 verifies the OpenRouter request with the real key and records cost per call.
- **web_fetch**: http(s) only; DNS-resolved private, loopback, link-local and metadata ranges are blocked, also after each redirect (max 5); 15 s timeout; 5 MB download cap; returns readable markdown cut at 100 KB.
- **MCP**: servers come from Settings → Tools (stored in our settings, added/edited/removed in the UI: name, command + args + env, or URL + headers) and from the thread project's `.mcp.json` (Claude Code format), always trusted. Tools are exposed through two tools of ours: `mcp_search({ query })` (lists matching server tools with schemas, connecting lazily) and `mcp_call({ server, tool, arguments })`. Connections are per (config source, server), reused across threads, closed after 10 idle minutes. Status never returns env or header values. `mcp_call` keeps the default `replay: "unsafe"` (an interrupted call returns `interrupted`); pooled connections reconnect lazily after a restart.
- **Background processes**: `process_start({ command, name? })`, `process_logs({ id, tail? })`, `process_stop({ id })`, `process_list()`; `replay: "unsafe"` (a crashed start becomes an interrupted result, never a second spawn). Each process runs in the thread's cwd in its own process group; a pid file `<home>/processes/<id>.json`. Killed (SIGTERM, SIGKILL after 5 s) on thread archive/delete and hub shutdown; on hub start, pid files from an earlier run are reaped (group killed if alive) and marked `killed`. Logs: 1 MB in-memory tail + a log file capped at 10 MB, deleted with the thread. URLs parsed from logs after stripping ANSI (`localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`).

## Contract (`packages/protocol`)

```ts
WorkspaceMode = "worktree" | "checkout"
ThreadWorkspace = {
  mode: WorkspaceMode;
  path: string;                    // cwd of the thread
  branch: string | null;           // pi/<slug> for worktrees
  base: string | null;
  state: "ready" | "merged" | "removed";
  mergedSha: string | null;
  pullRequestUrl: string | null;
}
ConversationSummary += {
  workspace: ThreadWorkspace;
  forkOf: { conversationId: string; entryId: string } | null;
  parentId: string | null;         // subagent children
}
StartConversationInput += { workspace?: WorkspaceMode }       // default from settings; ignored for non-git projects
SendMessageInput += { whenBusy?: "steer" | "followUp" }       // default from settings
Settings += { messageMode: "steer" | "queue"; workspaceDefault: WorkspaceMode }
WorkspaceStatus = { ahead: number; behind: number; dirtyFiles: string[]; unmergedCommits: number; canMerge: boolean; reason: string | null }
Checkpoint = { id: string; requestId: string; entryId: string | null; kind: "before" | "after"; at: number; files: { path: string; added: number; removed: number; status: "A" | "M" | "D" | "R" }[] }
RestorePreview = { checkpointId: string; changes: { path: string; action: "write" | "delete" }[] }
ProcessInfo = { id: string; conversationId: string; name: string; command: string; state: "running" | "exited" | "killed"; exitCode: number | null; startedAt: number; urls: string[] }
McpServerConfig = { name: string } & ({ command: string; args: string[]; env: Record<string, string> } | { url: string; headers: Record<string, string> })
McpServerStatus = { name: string; source: "settings" | "project"; transport: "stdio" | "http"; state: "idle" | "connected" | "error"; toolCount: number | null; error: string | null }
```
- `ConversationSummary` additions are stored in the index entry (so `toSummary` needs no extra read); legacy entries read as `{ mode: "checkout", path: project.path, branch: null, base: null, state: "ready", ... }`, `forkOf: null`, `parentId: null`.
- `listConversations` returns children too; the web nests them by `parentId`.

Core:
```ts
conversations: {
  fork(id: string, entryId: string): Promise<ConversationSummary>;
  rewindPreview(id: string, entryId: string): Promise<RestorePreview>;
  rewind(id: string, entryId: string): Promise<{ conversation: ConversationSummary; draft: string }>;
  cancelQueued(id: string, itemId: string): Promise<{ cancelled: boolean }>;
  checkpoints(id: string): Promise<Checkpoint[]>;
  checkpointDiff(id: string, checkpointId: string, path: string): Promise<string>;   // path repo-relative, no "..", passed after "--"
  remove(id: string, options?: { force?: boolean }): ...;                             // has_unmerged_work unless force
  ...
};
workspaces: {
  status(conversationId: string): Promise<WorkspaceStatus>;
  merge(conversationId: string): Promise<ConversationSummary>;
  createPullRequest(conversationId: string): Promise<ConversationSummary>;
  remove(conversationId: string, force: boolean): Promise<ConversationSummary>;
};
processes: { list(conversationId: string): Promise<ProcessInfo[]>; logs(id: string, tail: number): Promise<string>; stop(id: string): Promise<void> };
mcp: { servers(projectId: string | null): Promise<McpServerStatus[]>; save(config: McpServerConfig): Promise<void>; remove(name: string): Promise<void> };
settings: { setMessageMode(mode); setWorkspaceDefault(mode); ... };
```
- New error codes, each added to `ERROR_CODES`, `ErrorCodeSchema` and `ERROR_STATUS` (all 409): `thread_busy`, `merge_conflict`, `base_dirty`, `not_on_base`, `worktree_dirty`, `has_unmerged_work`. Other failures use existing codes: an action on a thread with no worktree → `invalid_request`; a blocked or failed `web_fetch`, an MCP server failure and a search with no backend are tool errors returned to the agent (never REST errors); a restore or git failure → `internal` with git's message.
- `Change += { resource: "processes", conversationId } | { resource: "mcp" }`.
- REST in the existing style: `POST /conversations/:id/fork`, `POST /conversations/:id/rewind/preview`, `POST /conversations/:id/rewind`, `DELETE /conversations/:id/queue/:itemId`, `GET /conversations/:id/checkpoints`, `GET /conversations/:id/checkpoints/:cid/diff?path=`, `GET /conversations/:id/workspace`, `POST /conversations/:id/workspace/merge`, `POST /conversations/:id/workspace/pull-request`, `DELETE /conversations/:id/workspace?force=`, `GET /conversations/:id/processes`, `GET /processes/:id/logs?tail=`, `DELETE /processes/:id`, `GET /mcp/servers?projectId=`, `PUT /mcp/servers/:name`, `DELETE /mcp/servers/:name`, `PUT /settings/message-mode`, `PUT /settings/workspace-default`.

## Core layout

- `core/src/workspaces/` (git worktree ops, lock, status, merge, PR, remove).
- `core/src/checkpoints/` (snapshot, diff, preview, restore, cleanup) + the submit/run-end calls.
- `core/src/harness/conversation-fork.ts` (fork, rewind).
- `core/src/harness/conversation-submit.ts` (`whenBusy`, cancel).
- `core/src/harness/tools/` one file per tool: `task`, `todo-write` (state in a `pi-everywhere.todos` doc), `web-search`, `web-fetch`, `mcp-search`, `mcp-call`, `process-*`. Phase 0 pre-wires all imports in `registry.ts`.
- `core/src/mcp/` (config merge, client pool via `@modelcontextprotocol/sdk`).
- `core/src/processes/` (registry, pid files, reaping, logs).
- Cleanup hooks: Phase 0 adds `onConversationRemoved` / `onProjectRemoved` lists in `conversations-api.ts` / `projects-api.ts`; A, B and E register their cleanup there from their own folders.

## Web

- **New thread composer** (git projects only): a "Worktree / Main checkout" toggle after the project picker.
- **Thread header**: a workspace chip (branch, ahead/behind, dirty count) with: Merge into base, Create PR, Remove worktree, Copy path. Errors show the canned-message actions (Ask agent to commit / to resolve).
- **Transcript**: per turn a "N files changed" row that expands to per-file diffs (reuse the edit diff view); message menus: "Fork from here", and on user messages "Rewind to here" (confirm lists `RestorePreview.changes`).
- **Queued messages**: mode label and a cancel button; `Alt+Enter` sends with the other mode.
- **Tool cards**: `task` (description, live status, open child), `todo_write` (checklist), `web_search` (results), `web_fetch` (url, size), `mcp_call` (server/tool, result), `process_*` (name, state, last lines).
- **Todo panel** above the composer: the latest list, collapsible, hidden when empty or all done.
- **Processes**: a toolbar chip with the running count; a sheet with each process, logs (auto-scroll), stop and URLs.
- **Sidebar**: subagent children indented under their parent (Threads and Projects modes), collapsible with the parent, status avatars; the child page is read-only with a "Subagent of <parent>" header link.
- **Settings**: "Agent" section (message mode, new threads use worktree/main checkout); "Tools" section (MCP servers: list with status, add/edit/remove dialog; project `.mcp.json` servers listed read-only per project).

## Testing

- Contract tags: `workspaces`, `checkpoints`, `fork`, `queue`, `subagents`, `processes`, `mcp`. The fake core implements all in memory.
- Core tests in temp git repos (never `~/src`): worktree create (root and subfolder project), merge ff, rebase conflict, dirty base overlapping and non-overlapping, not on base, busy guard, remove guards, slug collision; checkpoints with untracked, deleted, renamed and ignored files, subfolder project, restore exactness; fork history and init indexing; queue, cancel queued and cancel delivered; `task` parallel children and index entries (faux); `todo_write`; `web_fetch` against a local server (and blocked when it resolves to loopback — test via an injectable resolver); `web_search` parser against a saved HTML fixture; MCP with a tiny stdio test server; processes start/logs/stop, kill on delete, reap on restart.
- e2e (built CLI, faux): worktree thread → faux edits → commit → Merge; rewind restores a file; fork; queue mode + cancel; todo panel; processes sheet; subagent child in sidebar.
- Real run: a temp clone of one of the user's repos (never their checkout), OpenRouter key.

## Parallel work

### Phase 0 (three agents)
- **0a contract**: protocol, errors, REST, server routes and tests, fake core + contract suite (pending tags). Commits first.
- **0c core foundation** (after 0a): core stubs, `create-core.ts` wiring, `registry.ts` with every tool file stubbed, cleanup hook lists and `remove` options in `conversations-api.ts` / `projects-api.ts`, index entry fields (`workspace`, `forkOf`, `parentId`) with legacy defaults and `toSummary` in `conversation-store.ts`. It also adds the settings storage for `messageMode`, `workspaceDefault` and `mcpServers` (in `core/src/home/settings-store.ts` + `settings-api.ts` getters/setters) and the stub `mcp.save/remove` that persist to it, so D and F never share a file. 0c owns these shared files for the milestone; Phase 1 agents only call them. At the end of Phase 0 the real core's stubs pass the contract suite with the new tags pending. Pins in `CONTRACT-CHANGES.md`: fork copies the agent doc; `whenBusy: "followUp"` delivery; `Submissions.abort` on delivered items; task ownership + `extensions.remove` + `init` on task children; OpenRouter web plugin request/response and cost.
- **0b web foundation** (after 0a's protocol commit): `lib/api`, queries, fake transport; tool-card map entries pointing to placeholder files; composer slots (`toolbarStart`, `abovePanel`) and message-menu slots so A, B, C, F do not share files; sidebar child nesting data shape; settings shells (Agent, Tools).

### Phase 1 (6 agents)
| Agent | Owns |
|---|---|
| A workspaces | `core/src/workspaces/**`, `web/src/workspaces/**` |
| B checkpoints + fork + rewind | `core/src/checkpoints/**`, `core/src/harness/conversation-fork.ts`, `web/src/conversation/checkpoints/**` |
| C subagents + todos | `core/src/harness/tools/{task,todo-write}*`, `web/src/conversation/tools/{TaskTool,TodoTool}*`, `web/src/conversation/todos/**`, `web/src/sidebar/subagents/**` |
| D web + MCP | `core/src/harness/tools/{web-*,mcp-*}`, `core/src/mcp/**`, `web/src/conversation/tools/{Web,Mcp}*`, `web/src/settings/tools/**` |
| E processes | `core/src/processes/**`, `core/src/harness/tools/process-*`, `web/src/processes/**`, `web/src/conversation/tools/Process*` |
| F steer/queue + Agent settings | `core/src/harness/conversation-submit.ts`, `web/src/conversation/queue/**`, `web/src/settings/agent/**` |

Mounting each agent's components in a slot is one line each, done by the integrator from notes.

### Phase 2: integration, e2e, real run in the browser.
