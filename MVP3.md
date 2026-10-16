# MVP3 plan

Status: APPROVED v3 (review rounds 1–2 applied; webr sidebar added). One open question for the user below. Builds on [MVP2.md](MVP2.md) (architecture, security, testing and parallel-work rules still apply). Product context: [PLAN.md](PLAN.md).

## Goal

> 1. If the GitHub CLI (`gh`) is installed and logged in, my GitHub repos show up in the project menu. Picking one uses its local copy in my code folder, or asks me to clone it or to point at an existing folder.
> 2. The sidebar works like webr's: sorted by activity, a flat list or grouped by project, smooth reordering, bot avatars per thread, and automatic project icons I can change.

## Scope

In:
1. **GitHub status** on the hub, shown in settings.
2. **GitHub repos** in the project menu ("On GitHub" group, searchable), with local-copy matching in the code folder.
3. **Repo → project** on first use: local copy → added at once; none → Clone or Use an existing folder.
4. **Code folder**: the projects folder is the user's code folder; the app suggests an existing `~/src`, `~/code`, `~/projects` or `~/dev` when the setting is still the default.
5. **Sidebar like webr**: activity sorting, a Threads / Projects switch, collapsible project groups, FLIP reorder animation, the current-row project "takeover", bot avatars, compact relative time, status badges on the avatar.
6. **Project icons**: found automatically in the project folder; a "Change icon" dialog (found images, upload, reset).

Out (later): GitHub issues/PRs, creating repos, GitHub Enterprise and `*.ghe.com`, auth without `gh`, other forges, a multi-select project filter (webr has none; see open questions), terminals in the sidebar.

## Product decisions

- The projects folder is the code folder: clones land there and the local-copy scan looks there. The MVP2 default (`~/.pi-everywhere/projects`) stays the default, but the settings GitHub row, and the setup step, offer "Use `~/src` as your code folder" (first of `~/src`, `~/code`, `~/projects`, `~/dev` that exists) while the setting is the default.
- The sidebar shows only real projects; GitHub repos appear only in the project menu until used.
- `gh` is optional. Without it nothing changes except the settings status line.
- Repos from a local copy or an existing folder become **folder** projects with a `gitUrl` (never deleted by the app). Only clones are `kind: "git"` (MVP2 rule: their folder is a claimed child of the projects folder).
- `GH_TOKEN`/`GITHUB_TOKEN` in the hub's environment take precedence over the stored gh login (gh's own rule); the status shows the token source.

## Contract (`packages/protocol`)

```ts
GithubStatus =
  | { state: "connected"; login: string; gitProtocol: "https" | "ssh"; tokenSource: string }
  | { state: "not_installed" }                       // also: gh not on the hub's PATH
  | { state: "not_logged_in"; hint: string }
  | { state: "error"; message: string }             // offline, 5xx, gh too old
GithubRepo = {
  nameWithOwner: string;        // pattern ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$
  description: string | null;
  private: boolean;
  pushedAt: number;
  localPath: string | null;     // computed per call against the current scan
  projectId: string | null;     // computed per call against the current projects
}
UseGithubRepoInput = { nameWithOwner: string; mode: "local" | "clone" | "folder"; path?: string }
SuggestedCodeFolder = { path: string } | null
```
- `Project` gains optional `iconUrl: string | null` (see Project icons) and folder projects may carry `gitUrl`.
- `ConversationSummary` gains `avatarIndex: number` and `lastActivityAt: number` (see Sidebar).

Core:
```ts
github: {
  status(): Promise<GithubStatus>;
  repos(): Promise<GithubRepo[]>;                 // archived/disabled dropped, most recently pushed first
  refreshRepos(): Promise<GithubRepo[]>;          // one refresh in flight at a time
  use(input: UseGithubRepoInput): Promise<Project>;   // idempotent
};
settings: { suggestedCodeFolder(): Promise<SuggestedCodeFolder>; ... };
projects: {
  icon(id: string): Promise<{ contentType: string; data: Uint8Array } | null>;
  iconCandidates(id: string): Promise<{ name: string; index: number }[]>;  // max 12
  iconCandidate(id: string, index: number): Promise<{ contentType: string; data: Uint8Array }>;
  setIcon(id: string, png: Uint8Array | null): Promise<void>;              // null resets to automatic
  ...
};
```
- Errors: `github_unavailable` 409, `needs_folder` 409, `remote_mismatch` 422. `use` with an unknown `nameWithOwner` → `not_found`.

REST:
- `GET /github/status`, `GET /github/repos`, `POST /github/repos/refresh`, `POST /github/use` (201, project).
- `GET /settings/suggested-code-folder`.
- `GET /projects/:id/icon` (image; SVG with `Content-Security-Policy: sandbox`; `Cache-Control: no-cache` + ETag), `GET /projects/:id/icon-candidates`, `GET /projects/:id/icon-candidates/:index`, `PUT /projects/:id/icon` (`{ png: base64 }`, 1 MB limit), `DELETE /projects/:id/icon`.

## Core: GitHub (`core/src/github/`)

### Running `gh`
- `execFile(ghPath, args, { env, timeout: 15_000, maxBuffer: 8 MiB })`; injectable `runGh`.
- `env` = `process.env` + `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `NO_COLOR=1`, `GH_PAGER=cat`, with `GH_HOST`, `GIT_DIR`, `GIT_WORK_TREE` deleted. Every call passes `--hostname github.com`.
- Minimum gh: 2.81.0 (first release with `auth status --json`). `ghPath` = resolved absolute path of `gh` on PATH at startup (needed for the credential helper).

### Status (one call, cached 60 s)
- `gh auth status --hostname github.com --active --json hosts`:
  - spawn `ENOENT` → `not_installed` (hint in UI: gh must be on the PATH of the process running the app);
  - stderr "unknown flag: --json" → `error` "Update gh to 2.81.0 or later";
  - no `github.com` host → `not_logged_in` ("Run `gh auth login`");
  - `state: "success"` → `connected` (`login`, `gitProtocol`, `tokenSource`);
  - `state: "error"` with 401 → `not_logged_in` ("Run `gh auth refresh`"); any other → `error` with its message.
- Never call `gh auth token` or pass `--show-token`.

### Repos (cached 5 min; `refreshRepos` bypasses; one fetch in flight)
- `gh api --hostname github.com "user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member" --jq '[.[] | select((.archived or .disabled)|not) | {full_name, private, pushed_at, clone_url, ssh_url, description}]'`, validated with a TypeBox schema.
- Clone URL: `ssh_url` when `gitProtocol` is `ssh`, else `clone_url`; always passed through `checkGitUrl`.
- SSO note: org repos can be missing silently (`X-GitHub-SSO: partial-results`); not handled in MVP3.

### Repository key (`core/src/git/repository-key.ts`)
- `repositoryKey(url)`: host `github.com` or `ssh.github.com`, any scheme/user/port 22/443 → `github.com/<owner>/<repo>` lowercased, `.git` stripped; other hosts → `normalizeGitUrl(url)`. `checkGitUrl`/`normalizeGitUrl` stay unchanged.
- Used by `ProjectStore.add/addGit` duplicate checks, `CloneService.requireNoDuplicate` and every MVP3 match.
- Test table: `git@github.com:Me/Repo.git`, `ssh://git@github.com/me/repo`, `ssh://git@ssh.github.com:443/me/repo.git`, `https://github.com/me/repo/`, `https://github.com/ME/REPO.git` → all `github.com/me/repo`; `https://gitlab.com/Me/Repo` → its normalized URL (case kept).

### Local scan (cached with the repo list)
- Refuse when the code folder is `/` or the home folder (macOS privacy prompts).
- `readdir(withFileTypes)` to depth 2; never follow symlinks; skip dot-dirs and `node_modules`; stop at 2,000 entries; do not descend into a dir that is itself a repo.
- A repo = `.git` file or dir (`lstat`). Remotes: `git -C <dir> config --get-regexp '^remote\..*\.url$'` (execFile, no shell, env without `GIT_DIR`/`GIT_WORK_TREE`), concurrency 8; every remote counts (forks).
- Ties: `<folder>/<repo>` exact path first, then the shortest path.
- `localPath` and `projectId` are computed on every `repos()` call against the current scan and projects (Home excluded); only gh data and scan results are cached.

### `use`
- Resolves `nameWithOwner` only from core's own list (unknown → `not_found`); never builds argv or paths from client strings.
- Idempotent: a matching project (by `repositoryKey` or path) is returned as is; concurrent calls for one repo share one promise.
- `local` → requires `localPath` (else `needs_folder`) → `projects.add({ path, gitUrl })` (folder project).
- `folder` → `resolveProjectFolder(path)`, any remote must match the key (else `remote_mismatch`) → folder project. Any folder is allowed (as `projects.add`).
- `clone` → MVP2 clone service with the repo's clone URL → `kind: "git"`.
- `ProjectStore.add` gains `gitUrl?` and a `repositoryKey` duplicate check.

### Private https clones
- Today's machine proves a stale `credential.helper` breaks private https clones under `GIT_TERMINAL_PROMPT=0`. When gh is connected and the clone URL is `https://github.com/…`, the clone service adds `-c credential.https://github.com.helper=` and `-c credential.https://github.com.helper=!'<ghPath>' auth git-credential` (clear, then gh's helper). This is a `CloneService` dependency `extraGitConfig(url): string[]`, frozen in Phase 0, used by `clone` and `retryClone`. No token passes through the app.
- Failure hints from the last stderr line: "could not read Username" → "Run `gh auth setup-git`"; "Permission denied (publickey)" → ssh key/agent; "Host key verification failed" → run `ssh -T git@github.com` once; "SAML"/"SSO" → authorize the token for the org.

## Core: code folder suggestion
- `settings.suggestedCodeFolder()`: when `projectsFolder` is the default, the first existing of `~/src`, `~/code`, `~/projects`, `~/dev`; else `null`.

## Core: sidebar data (Phase 0, in `toSummary`; no storage, no migration)
- `avatarIndex = conversationId` (already a monotonic number).
- `lastActivityAt = lastRunEndedAt ?? updatedAt` (webr's rule: starting work does not count; a run ending does; title changes do not). Pi has no separate "asks for input" state.

## Core: project icons (`core/src/icons/`)
- Discovery (local filesystem only, a port of webr `src/server/transport/icons.ts`):
  - Directories in order: `build/Icon.icon/Assets`, root, `public`, `static`, `assets`, `web`, `web/public`, `app/public`, `src/assets`, `src/app`, `frontend/public`, then `src/*/public` (first 8), then `apps/*/{public,static,assets,src/assets,src/app}` (first 32; app names containing the repo name first).
  - Rank: `favicon` 0, `favicon-*` 1, `apple-touch-icon*` 2, `icon`/`app-icon` 3, `icon-*`/`logo`/`brand`/`mark` 4, `logo-*`/`brand-*` 5. Extensions ico, png, svg, webp. Max 2 MB. Reject anything whose realpath leaves the project.
  - First directory with a match wins; candidates (max 12) sorted by rank, addressed by their relative `name` (not an index).
  - Runs only in the icon GET routes, never in `projects.list()`; cached 60 s per project; ETag from mtime and size.
  - Home is never scanned (it would pick a random repo's icon); it gets a fixed house icon in the web.
- Custom icon: a 128×128 PNG (the browser redraws any choice to it) stored as `<home>/icons/<projectId>.png` with `atomic-write`. The server checks the PNG magic bytes and the 128×128 size; max 256 KB. Custom wins over discovered. `projects.remove` deletes it.
- `Project.iconUrl` = `/api/projects/:id/icon?v=<custom hash or "auto">` always (Home: `null`); the GET returns 404 when there is no icon, and `ProjectIcon` falls back to the letter.
- Every icon response: `X-Content-Type-Options: nosniff`; SVG also `Content-Security-Policy: sandbox`.
- Candidate routes: `GET /projects/:id/icon-candidates` → `[{ name, url }]`, `GET /projects/:id/icon-candidates/file?name=<relative name>` (validated against the current candidate list). Core methods take `name` instead of `index`.

## Web

### Design system first (Phase 0)
- `BotAvatar` wrapper around `bot-avatars@0.1.2` (pinned; Phase 0 adds the dependency): `avatarIndex` → type `botAvatarTypes[i % len]`, color `hsl(i*137.508 % 360, 72%, 58%)`, seed `(i*0.618033…) % 1`; `state` working/default; `paused`; static under reduced motion. Status badge slot (top-left).
- `ProjectIcon`: 17 px tile, initial letter on a tinted token color, image fades in on load, letter on error.
- `SegmentedControl` (two icon buttons, `aria-pressed`).
- `useFlipList(containerRef, resetKey)`: WAAPI `translateY` 160 ms ease-out on `[data-flip-id]` rows for pure reorders and on `resetKey` change; skipped under `prefers-reduced-motion`.
- `Combobox` gains option `icon` and `hint`, and a group action slot (refresh).
- `RelativeTime` (`now`, `5m`, `3h`, `2d`).
- `SidebarThreadRow`: the webr row on theme tokens (grid `25px 1fr auto`, avatar slot, context slot, title, time/action slot that swaps on hover and is always visible on touch, `current` with the accent bar, the takeover transforms via `--project-offset-*` measured with a ResizeObserver). E only composes it; no bespoke CSS in feature code.
- A global reduced-motion rule (transitions/animations ~0).
- Test setup (`web/src/test/setup.ts`): a global `vi.mock("bot-avatars")` and an `Element.prototype.animate` stub (jsdom has neither canvas 2D nor WAAPI).

### Sidebar (port of webr `Sidebar.tsx` + `sidebar.css`, on our tokens)
- Header: Add project, New thread, the Threads / Projects `SegmentedControl` (localStorage `pie-sidebar-mode`, default `threads`).
- **Threads mode**: one flat list over `useAllConversations`, sorted by `lastActivityAt` desc (tie: id desc). Cloning and failed projects show as status rows at the top (spinner; failed with Retry and Remove). Archived threads in one collapsible "Archived" section at the bottom.
- **Projects mode**: groups (Home included) ordered by their newest thread's `lastActivityAt`; projects without threads (new, cloning, failed) follow as groups after the active ones, so Retry/Remove stay reachable; archived threads in a collapsed "Archived" group per project (MVP2); threads newest first; group header toggles collapse (localStorage `pie-sidebar-closed-projects`, JSON array), chevron, `aria-expanded`; header menu: New thread, Rename, Change icon, Remove, folder path with `~`.
- Row: grid `25px 1fr auto`, min-height 56 px: `BotAvatar` (working while running; status badge: error, unseen done), two lines (context line: project icon + name in Threads mode, nothing extra in Projects mode; then the title), `RelativeTime` of `lastActivityAt`. Hover shows the archive button instead of the time; always visible on touch. Row menu (always reachable on touch): Rename, Archive, Delete. Tooltip: title, project, model, status.
- Current row: raised surface and an accent bar; the project icon moves onto the avatar (webr "takeover", 200 ms, scale 1.4) while the avatar fades — in Threads mode from the context line, in Projects mode fading in at the avatar spot.
- `useFlipList` on the list; `resetKey` bumps on group toggle.
- Avatar: `size={24}`, `turn={working ? undefined : 0}`. Project tile color: hue hashed from the project id.
- Mobile ≤ 760 px: drawer as today (shadcn `Sheet`), closes on navigation.

### GitHub in the project menu
- Groups: "Projects", then "On GitHub" (searchable; `github:owner/repo` values; lock icon for private; "local" hint; relative pushed time; refresh group action).
- Pick a repo with `localPath` → `use(local)` → select the project. Without → `UseRepoDialog` (Clone into the real claimed folder shown after the call, or Use an existing folder) → select the (cloning) project.
- `pickProjectId` keeps a chosen cloning project (never falls back to Home); Send disabled with "Cloning…" until ready.
- Settings: GitHub row (status, login, token source, hints), and the code-folder suggestion button.
- `use-changed-invalidation.ts`: a `projects` change also invalidates `["github", "repos"]` (Phase 0).

### Change icon dialog (port of webr `ProjectIconDialog.tsx`)
- Title "Change icon for {name}", current preview, `DropZone`/file input (`image/*`), grid of up to 12 found images, buttons Reset to default and Cancel. Every choice is redrawn on a canvas to a 128×128 letterboxed PNG, then `PUT`.

## Testing
- Core GitHub: `runGh` fake per status JSON (empty hosts, success, error 401, timeout, unknown flag, ENOENT); repos projection and maxBuffer; `GH_HOST` ignored; credential-helper args only for https github.com; `repositoryKey` table; scan (symlink not followed, worktree `.git` file, nested repo not descended, two copies tie-break, home and `/` refused); `use` in each mode, idempotent and concurrent; `projectId` updates after `use` without refresh.
- Core sidebar/icons: `avatarIndex`/`lastActivityAt` derivation in `toSummary`; icon discovery ranking and directory order against temp trees; realpath escape rejected; Home never scanned; custom icon wins; reset; PNG magic/size check; icon deleted with the project; candidate by name after the list changed.
- Contract suite + fake: `github.*` with a fixed repo list; icons; new summary fields.
- Server: every route; SVG CSP header; icon PUT limit.
- Web: picker groups and dialog flows; cloning selection never falls back to Home; settings GitHub row per state; sidebar modes (empty/cloning/failed projects reachable in both modes), sorting, collapse persistence, FLIP skipped under reduced motion, row layout, takeover class on the current row, icon dialog.
- e2e (faux): a fake `gh` on `PATH` answering the frozen argv (status JSON, repos JSON whose `clone_url` is a local bare repo, with `PI_EVERYWHERE_ALLOW_FILE_CLONES=1`); pick a repo with a local copy → thread; pick one without → clone → thread; switch sidebar modes; change a project icon.

## Parallel work

### Phase 0 (integrator)
- Protocol: entities, `Core.github`, settings and icon methods, errors and statuses, routes (no query strings).
- Core: `create-core.ts` wiring with `runGh`, the gh env and `ghPath`; `ProjectStore.add({ gitUrl? })`; `CloneService` `extraGitConfig` dependency; `repository-key.ts` signature; `avatarIndex`/`lastActivityAt` derived in `toSummary`; `projects.icon*`/`setIcon` pre-wired to an `icons/` service stub, the `iconUrl` mapping and the icon cleanup on remove.
- Protocol `RouteDef`: a binary route kind (`responseKind: "image"`); `api.ts` exposes icon and candidate URLs as `<img src>` strings (cookie auth works for GET).
- Web `lib/preferences.ts`: `sidebarMode` and `closedProjects` keys.
- The fake `gh` script and the exact argv list it answers (shared by core tests and e2e).
- Testkit: fake core and contract cases (tags `[github]`, `[icons]`, `[sidebar-data]`).
- Web: design-system components above, `api.ts`, `queries.ts` hooks, the invalidation change, `bot-avatars` dependency.
- AGENTS.md ownership for MVP3.

### Phase 1 (5 agents)
- **A1 — core GitHub**: `core/src/github/**`, `git/repository-key.ts`, `git/clone-service.ts` (helper args, hints), `project-store.ts` duplicate checks, settings suggestion.
- **A2 — core icons**: `core/src/icons/**` only.
- **B — server**: routes, image responses, CSP, limits.
- **C — web project menu + settings**: `routes/ProjectPicker.tsx`, new `github/**` (dialog), settings rows. Does not edit `NewThreadPage.tsx` beyond wiring.
- **E — web sidebar + icons**: `sidebar/**`, new `icons/**` (Change icon dialog).

### Phase 2: integration, e2e, real run with the user's `gh` and `~/src`.

## Open questions for the user
- webr has no project filter; this plan ports its Threads / Projects switch and per-project collapse. Is a multi-select "show only these projects" filter wanted too?
