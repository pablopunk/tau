# MVP4 plan

Status: APPROVED v3 (review rounds 1–2 applied). Builds on [MVP3.md](MVP3.md) and [MVP2.md](MVP2.md) (architecture, security, testing and parallel-work rules still apply).

## Goal

> 1. Settings is one dialog with sections (left nav), not one long column.
> 2. I can connect OpenAI (API key or my ChatGPT subscription), Anthropic, Google and OpenCode (Zen + Go) next to OpenRouter, and pick any of their models.
> 3. I can pick light, dark or system theme.
> 4. In the composer, `/` opens commands (`/compact` first), `@` mentions files and skills, and a small meter shows how full the context is.

## Scope

In:
1. **Sectioned settings**: General, Providers, Models, Projects, GitHub. Left nav on desktop, list → section on phone.
2. **Providers**: OpenRouter (key), OpenAI (key or "Sign in with ChatGPT"), Anthropic (key), Google (key), OpenCode (one key, Zen + Go). Connect, status, disconnect. Setup step 1 becomes "Connect a provider".
3. **Models across providers**: model picker grouped by provider, only connected providers.
4. **Appearance**: System / Light / Dark.
5. **Slash commands**: `/compact [instructions]`, `/new`, `/model`, `/thinking`, `/rename`, `/archive`.
6. **Context meter** in the composer toolbar, from provider-reported usage.
7. **`@` mentions**: project files and available skills.
8. **Skills**: discovered `SKILL.md` files are listed to the agent in the system prompt.

Out (later): Claude Pro/Max and Copilot sign-in, custom OpenAI-compatible providers, compaction/retry settings, enabled-model lists, default thinking level, AGENTS.md editor, skills as slash commands, prompt templates, multiple accounts per provider.

## Product decisions

- One credential per provider. OpenAI is either an API key or a ChatGPT login; connecting one replaces the other.
- Env keys (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENCODE_API_KEY`) count as connected (`source: "env"`). The row says "From environment" and has no Disconnect. A stored credential wins over env; after Disconnect such a row flips to "From environment" (the row's help text says so).
- OpenCode is one row. Its key is stored under both pi-ai ids `opencode` (Zen) and `opencode-go` (Go); the model picker shows them as "OpenCode Zen" and "OpenCode Go".
- ChatGPT sign-in: the row says "Uses your ChatGPT plan. Personal use." Nothing else blocks it.
- Mentions stay plain text in the message (`@src/app.ts`, `@skill-name`). The system prompt tells the agent what they mean. No new send fields.
- Theme is a per-browser preference (`lib/preferences.ts`), not a hub setting.
- Disconnecting a provider never edits threads. A thread whose model's provider is gone shows the model with "Not connected"; sending fails with `no_provider`; the user picks another model.

## Contract (`packages/protocol`)

```ts
ProviderId = "openrouter" | "openai" | "anthropic" | "google" | "opencode"
ProviderMethod = "api_key" | "chatgpt"
ProviderInfo = {
  id: ProviderId; name: string;
  methods: ProviderMethod[];                    // openai: ["api_key", "chatgpt"], others: ["api_key"]
  keyUrl: string;
  connection: null | { method: ProviderMethod; source: "file" | "env"; valid: boolean | null };
}
LoginSession = {
  id: string;                                   // randomUUID
  provider: "openai"; method: "chatgpt";
  state: "starting" | "waiting" | "done" | "failed" | "cancelled";
  authUrl: string | null;                       // open in a new tab
  error: string | null;
}
ModelInfo += { providerName: string }           // "OpenAI", "OpenCode Zen", "OpenCode Go", ... from our table
FileSuggestion = { path: string; kind: "file" | "directory" }   // relative to the project folder, no leading ./
Skill = { name: string; description: string; scope: "project" | "user"; path: string }  // path: project-relative or ~-relative
CompactInput = { instructions?: string }        // maxLength 2000
Change += { resource: "providers" }
```
- `ERROR_CODES`, `ErrorCodeSchema` and `ERROR_STATUS` gain `login_failed` (422) and `nothing_to_compact` (409). `invalid_key` 422, `no_provider` 409, `not_found` 404 exist.

Core (replaces `provider.status/setApiKey/listModels`):
```ts
providers: {
  list(): Promise<ProviderInfo[]>;
  setApiKey(id: ProviderId, key: string): Promise<ProviderInfo>;   // validates first; invalid_key stores nothing
  disconnect(id: ProviderId): Promise<ProviderInfo>;               // removes the stored credential only
  startLogin(id: "openai"): Promise<LoginSession>;                 // one active session; starting one awaits cancel of the old
  login(sessionId: string): Promise<LoginSession>;
  submitLoginUrl(sessionId: string, url: string): Promise<LoginSession>;
  cancelLogin(sessionId: string): Promise<void>;
};
models: { list(): Promise<ModelInfo[]> };       // all connected providers; [] when none
conversations: { compact(id: string, input: CompactInput): Promise<void>; ... };   // resolves when compaction ends
projects: { suggestFiles(id: string, query: string): Promise<FileSuggestion[]>; ... };  // max 20
skills: { list(projectId: string | null): Promise<Skill[]> };
```

REST (`/provider` and `/provider/key` are removed):
- `GET /providers`, `PUT /providers/:id/key` `{key}`, `DELETE /providers/:id`.
- `POST /providers/:id/login` (201, session), `GET /logins/:sid`, `POST /logins/:sid/url` `{url}`, `DELETE /logins/:sid`.
- `GET /models`.
- `POST /conversations/:id/compact` `{instructions?}` (200 after it ends; the web does not wait on it to show progress).
- `POST /projects/:id/files/suggest` `{query}`, `GET /skills?projectId=`.

## Core: providers (`core/src/provider/`)

- Register pi-ai providers `openrouter`, `openai`, `anthropic`, `google`, `opencode`, `opencode-go`. A `PROVIDERS` table (Phase 0, frozen shape) maps our `ProviderId` → pi ids with display names, env var, key URL, validator.
- Credentials stay in `FileCredentialStore` (0600), keyed by pi id; the OpenCode key is written to both ids in one `modify`.
- `connection`: read `credentials` for the pi id first (stored → `source: "file"`, `method` from the credential type: `api_key` or `oauth` → `chatgpt`); only when nothing is stored, `models.getAuth(piId)` decides `source: "env"`. Not `getAvailable`, which counts env keys too.
- Validators (10 s timeout; the key is saved only when not `invalid_key`; network/5xx → `valid: null`). Status codes checked by the reviewer with curl:
  - OpenRouter: existing `openrouter-key.ts`.
  - OpenAI `GET https://api.openai.com/v1/models` (Bearer): 401 → invalid.
  - Anthropic `GET https://api.anthropic.com/v1/models` (`x-api-key`, `anthropic-version: 2023-06-01`): 401 → invalid.
  - Google `GET https://generativelanguage.googleapis.com/v1beta/models?key=`: **400 with `INVALID_ARGUMENT`**, 401 or 403 → invalid.
  - OpenCode `GET https://opencode.ai/zen/v1/models` **with** `Authorization: Bearer <key>` (without the header it returns 200): 401 → invalid.
- `models.list()`: `models.getAvailable(piId)` per connected pi id (applies `filterModels`, so ChatGPT logins get their own list); OpenRouter keeps `personalizeOpenRouterCatalog`. Ordered by the table, then pi's order.
- `settings-api.ts` `requireListedModel` message becomes provider-neutral.

### ChatGPT login (`core/src/provider/login-sessions.ts`)

pi's `loginOpenAIChatGPT` starts a callback server on `127.0.0.1:1455`, notifies `auth_url`, and immediately prompts `manual_code`, racing the two.
- `startLogin` runs `models.login("openai", "oauth", interaction, { getDeviceId, agentName: "tau" })` in the background with an `AbortSignal` (10 min).
  - `getDeviceId`: a UUID created once in `<home>/device-id` (written with the private-file helper, 0600).
  - `notify({type: "auth_url"})` → `authUrl`, state `waiting`.
  - `prompt({type: "manual_code"})` → held; `submitLoginUrl` resolves it. The callback server still wins when the browser runs on the hub machine.
  - Any other prompt type → session `failed` (`login_failed`).
- The pasted value must be the full callback URL `http://127.0.0.1:1455/auth/callback?...` (pi checks origin and path exactly, `openai-chatgpt.js:19-22,52-54`). pi's rejection message becomes the session `error`; the session keeps waiting until 5 attempts.
- pi's own errors (e.g. "Port 1455 is in use … Cancel that login") are passed through as `error` unchanged.
- `cancelLogin` aborts and awaits the login promise settling (so the port is free) before a new `startLogin` begins.
- Sessions live in memory; dropped 1 minute after a terminal state. `submitLoginUrl`: max 5 attempts per session, the value is never logged. On `done` emit `{resource: "providers"}`.

## Core: composer backends

- **Compact** (`core/src/harness/conversation-compact.ts`): find the conversation like `known(id)`, call `conversation.compact(instructions, BACKGROUND)`, and await it with `harness.waitForTask(taskId, BACKGROUND)` (pi-durable `harness/types.d.ts:667`). Phase 0 pins how `SettledTask` reports failure and how `CompactionResult` shows "nothing placed". Unknown id → `not_found`; a result with nothing placed → `nothing_to_compact`; failure → `AppError("internal")` with pi's message.
- **Compaction and usage in the view** (Phase 0, failing-first test on a real faux-mode compaction): assert that the web's `ConversationView` carries the summary entry's `kind` and `head`, assistant `usage`, and `LiveState.compactions` in `pi.live`. Record the shapes in `CONTRACT-CHANGES.md`. **If any is missing**, core publishes a small `tau.context` doc in the view (`{ usedTokens, compacting, compactedAt[] }`) and the web reads that instead; B then owns it. Manual, threshold and overflow compactions all render the same way.
- **File suggestions** (`core/src/fs/suggest-files.ts`): in a git repo `execFile("git", ["ls-files", "-co", "--exclude-standard", "-z"])` in the project folder (no shell, cached 10 s per project); otherwise a walk (depth 4, 5,000 entries, skips dot dirs, `node_modules` and symlinks). Directories are derived from file paths. A query containing `..` or starting with `/` or `~` → `[]`. Rank like `combobox-rank.ts` (basename prefix > basename substring > path substring), max 20. Home project works the same (walk, capped).
- **Skills** (`core/src/skills/`): `*/SKILL.md` in project `.agents/skills`, `.pi/skills`, `.claude/skills` and user `~/.agents/skills`, `~/.pi/agent/skills`, `~/.claude/skills`. Frontmatter `name` + `description` required (else skipped); SKILL.md max 256 KB; description cut at 300 chars; symlinks that resolve outside their skills dir are skipped. Project wins on a name clash. Cached 30 s.
- **System prompt** (`coding-extension.ts`): a "Mentions" section ("`@path` is a file or folder relative to the working directory; read it before answering.") and a "Skills" section (name — description — path; "when the user writes `@name` or the task matches, read that SKILL.md first and follow it"), omitted when there are none.

## Web

### Design system first (Phase 0)
- `components/ui/settings-layout.tsx`: shadcn `Sidebar` (`collapsible="none"`) inside `DialogContent`, `max-w-3xl`, height `min(640px, 85vh)`, content in `ScrollArea`. Below `md`: the nav is a list; picking opens the section with a back button.
- `components/ui/mention-menu.tsx`: a `Popover` anchored **above the textarea** (not the caret; mobile keyboards) + `Command`, fully controlled (open, items, active index, onSelect).
- `components/ui/context-meter.tsx`: a small ring (SVG stroke on our tokens) with a `Tooltip`.
- `ModelCombobox` groups by `providerName` (`CommandGroup`).

### Settings (`web/src/settings/`)
- `useOpenSettings(section?)` opens on a section; the palette gets one item per section.
- General: Appearance (System / Light / Dark), Notifications (moved).
- Providers: one row per provider: name, status badge (Connected · key / Connected · ChatGPT / From environment / Key not checked / Invalid key), actions (Add key / Replace key / Sign in with ChatGPT / Disconnect). Inline key input with a "Get a key" link.
- ChatGPT dialog: "Open sign-in page" (new tab); below it, always visible while `waiting`: "On another device? After signing in, the page fails to load. Copy its address and paste it here." The input accepts only URLs starting with `http://127.0.0.1:1455/auth/callback` (client check; the server check is pi's). Polls `GET /logins/:sid` every second; closes on `done`, shows `error` on `failed`; closing the dialog cancels.
- Models: default model, fast model. Projects: projects folder, code folder suggestion, data home text. GitHub: the gh row.

### Setup
- Step 1 "Connect a provider" reuses the provider rows; Continue enables once any provider is connected. Step 2 is unchanged. The app gate becomes "no connected provider or no default model".

### Theme
- `lib/theme.ts` applies `.dark` on `<html>`; `system` follows `matchMedia("(prefers-color-scheme: dark)")` live. An inline script in `index.html` sets it before first paint (no CSP on HTML today; keep it that way or hash the script).

### Composer (`web/src/conversation/Composer.tsx`, new files in `web/src/conversation/composer/`)
- `/` as the first character of the text opens the command menu (images attached do not matter). `@` at the start or after whitespace, when typed (not pasted), opens file + skill suggestions (debounce 120 ms).
- While a menu is open: `ArrowUp/Down` move, `Enter` and `Tab` pick (checked before the plain-Enter send), `Esc` closes the menu (checked before the busy-Esc stop); nothing happens while `isComposing`.
- `/compact` with text after it passes the text as instructions. `/model` and `/thinking` open the toolbar pickers. Commands that need a thread are hidden on the new-thread page.
- Picking a file or skill inserts `@path ` or `@skill-name `.
- Context meter: `contextUsage(entries, contextWindow)` (pure, tested): take the last assistant message after the latest compaction head; tokens = `usage.totalTokens` if > 0, else `input + cacheRead + cacheWrite + output` (pi-ai reports `input` without cached tokens, `api/openai-completions.js:1180`); add `chars / 4` for later messages. Hidden when there is no usage yet. Tooltip "42k of 200k tokens · 21%".
- Transcript: "Compacting context…" while a compaction runs; a "Context compacted" divider at the summary entry.

## Testing

- Contract tags: `providers`, `login`, `compact`, `files`, `skills`. The fake core implements all. Real core in faux mode replaces the `openai` provider (via `setProvider`, next to `core/src/testing/faux-provider.ts`) with one whose `auth.oauth.login` notifies `auth_url`, then prompts `manual_code` and accepts exactly `http://127.0.0.1:1455/auth/callback?code=ok&state=faux`.
- Unit: validators per provider with stubbed `fetch` (incl. Google 400 and OpenCode header), `contextUsage` (with and without compaction), file ranking and the `..` guard, skills frontmatter and caps, slash/mention parsing and keys, theme.
- e2e (built CLI, faux): settings sections on desktop and phone width; add + disconnect a key; ChatGPT dialog success and `login_failed`; `/compact` shows the divider; `@` inserts a path; theme switch survives reload.
- Real run: OpenRouter + other keys if the user gives them; the user validates ChatGPT sign-in.

## Parallel work

### Phase 0 (foundation, two agents in parallel)
- **0a contract + core** (owns protocol, server, testkit, core wiring): schemas, errors, `Core`, REST table, server routes and tests, fake core + contract suite (pending tags), `PROVIDERS` table, stubs for every new method, `create-core.ts` wiring, faux OAuth provider in `core/src/testing/`. Pins in `CONTRACT-CHANGES.md`: compaction/usage view test (above), `SettledTask` failure and "nothing placed", `getAuth` labels, validator status codes.
- **0b web foundation** (owns `web/src/lib/**`, `web/src/app/**`, `web/src/components/ui/**`, `setup/ModelCombobox.tsx`): `lib/api.ts`, `lib/queries.ts` (keys `providers`, `models`, `skills`), `lib/transport/fake.ts`, `lib/preferences.ts` theme field, `App.tsx` gate, `settings-dialog.tsx` with `useOpenSettings(section?)` rendering a `settings/SettingsDialog.tsx` shell (sections wired to today's components, moved from `setup/`), palette items per section, the ui components above, `ModelCombobox` grouping. Codes against 0a's protocol, which 0a commits first.
- Done when check, test and build pass on the merged result.

### Phase 1 (4 agents)
| Agent | Owns |
|---|---|
| A providers-core | `core/src/provider/**`, `core/src/auth/**`, `core/src/settings-api.ts` |
| B composer-core | `core/src/harness/conversation-compact.ts`, `core/src/harness/coding-extension.ts`, `core/src/harness/live-state*`, `core/src/fs/suggest-files*`, `core/src/skills/**` |
| C settings-web | `web/src/settings/**` (except the 0b shell's wiring), `web/src/setup/**` incl. `KeyForm.tsx`, except `ModelCombobox.tsx`, `web/src/lib/theme.ts` (new), `web/index.html` |
| D composer-web | `web/src/conversation/**`, `web/src/components/ModelThinkingPickers.tsx` |

The palette, sidebar and anything else needed go in notes for the integrator.

### Phase 2: integration, e2e, real run in the browser.
