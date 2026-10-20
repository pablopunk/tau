# PLAN: Fast compaction via generic decision models (JEV-style)

## Goal

Add opt-in **fast compaction** to tau: at compaction time, score each old tool
exchange with a calibrated yes/no decision model and keep / truncate / drop it
verbatim — no LLM summary. Generic backend interface so TypeSafe Jev is first,
OpenAI Decisions (`gpt-6-luna`) is second, and a third backend is one new file.

Default stays **off**. The user opts in from agent settings, which is only
enabled when ≥1 compatible backend is connected.

## Background (research)

- Jev compaction pattern: per-item `keep` question, thresholds keep/truncate/drop,
  pin first + recent N, everything kept byte-for-byte. ~0.3–0.6 s, ~$0.0004–0.0014
  vs $0.01–0.15 + 1–60 s for an LLM summary.
  (`https://www.jevtypesafeai.com/jev-compaction`)
- TypeSafe API: `POST https://api.typesafe.ai/v1/systemone`, `model: jev-latest`,
  `questions: { keep: { type: "noul", ... } }` → `answers.keep.noul: 0..1`.
  $0.042/Mtok input-only. `GET /v1/models` for key validation.
- OpenAI Decisions API (public beta): `POST https://api.openai.com/v1/decisions`,
  `model: gpt-6-luna`, `predicate` → `probability`. Same key as chat.
  (`https://developers.openai.com/api/docs/guides/decisions`)
- Pi plugins reviewed: `pi-jev-compaction` (verbatim structured summary, closest
  fit), `fast-jev-compaction-pi` (best bench: 0.44 s, continuity via persisted
  pruned transcript), `pi-jev` (suite, too broad), `jev-compactor` lib (also a
  safety gate — out of scope).
- Hard constraint (all three plugins agree): **Pi compaction is summary +
  cut-point, not transcript replace.** `pi-durable@1.3.0` `CompactionHooks`:
  `beforeCompact({ reason, entries, messages, firstKept, instructions? })` →
  `{ summary }` xor `{ decline: true }` xor `undefined` (= run built-in).
  Old pruned items survive only inside the summary string;
  the tail after `firstKeptEntryId` is untouchable. So this is "lossless for
  text, lossy for tool bulk" summary encoding — still a large win, but never
  claim full-transcript replace.
- LiteLLM's alternative (per-request `pre_call` pruning via `beforeRequest`) is
  explicitly **phase 2**, not this plan.

## Design

### 1. Generic `DecideClient` (new folder `packages/core/src/decisions/`)

```ts
interface DecideClient {
  readonly id: "typesafe" | "openai";
  /** Cheap capability probe. `ready` | `unavailable` | `unknown`. */
  check(): Promise<Availability>;
  /** One predicate question over shared input → calibrated 0..1. */
  predicate(input: string, instructions: string): Promise<number>;
}
```

- `typesafe.ts`: `POST {baseUrl}/v1/systemone`, `noul` question. Key resolution:
  file credential `typesafe` → `TYPESAFE_API_KEY` env. Never logs the key.
- `openai.ts`: `POST https://api.openai.com/v1/decisions`, `predicate`,
  `gpt-6-luna`. Reuses the stored/env OpenAI key. Probe is a trivial question
  over `"hello"` (no conversation data): `200` → ready; `404/403/model_not_found`
  → unavailable; network fail → unknown (never cache negative hard).
- `selector.ts`: `pick(preference, clients)` — `auto` tries backends in a fixed
  order (spike decides: cheapest/fastest first), explicit id pins one.
- Availability cache: in-memory per key-fingerprint, TTL ~24 h, re-probe on key
  change and on live 404 (demote). Compaction never waits on a probe: unknown
  tries live, fails soft to next backend → `return undefined` (built-in summary).
  **Fallback is ALWAYS `undefined`, never `decline`.** In pi-durable,
  `undefined` = "run the built-in summarizer"; `decline` = "skip compaction
  entirely, place no summary". Declining a manual `/compact` surfaces
  `nothing_to_compact` to the user, and declining an **overflow** compaction
  fails the run. `decline` is reserved for a deliberate skip (e.g. reduction
  not worth it on a manual/threshold run) and MUST never be returned when
  `reason === "overflow"`.

### 2. TypeSafe as a chat-less provider

`packages/core/src/provider/providers-table.ts`: new `KeyProviderEntry`:

```ts
{ id: "typesafe", name: "TypeSafe", methods: ["api_key"],
  keyUrl: "https://console.typesafe.ai/settings/keys", envVar: "TYPESAFE_API_KEY",
  piProviders: [], validate: validateTypesafeKey }
```

`piProviders: []` means zero chat models (`model-list.ts` iterates it) — it can
never be a default/fast model. Required touch-ups for the empty case:

- `protocol/.../entities.ts`: add `"typesafe"` to `ProviderIdSchema`.
- `provider-service.ts` `setApiKey`/`disconnect`: write/delete under
  `[primaryPiId(entry)]` (existing helper falls back to `entry.id` =
  `"typesafe"`) — with `[]`, `writeMany([])` is a silent no-op today and
  `deleteMany([])` would leave a stale `"typesafe"` key behind.
- `connections.ts`: model-less entries can't resolve env keys via
  `models.getAuth` (no pi-ai provider registered — deliberately). Pass `env`
  into the reader (or equivalent) and check `entry.envVar` directly.
- Shared `countsForChat(entry) = entry.piProviders.length > 0` predicate used
  by BOTH `isConfigured()` (TypeSafe alone must not pass setup /
  `no_provider` gates in `conversations-api.ts` / `settings-api.ts`) AND
  `model-list.ts` `listFaux`'s `keyed` check (a connected TypeSafe in faux mode
  must not conjure faux chat models).
- `validators.ts`: `validateTypesafeKey` = `GET https://api.typesafe.ai/v1/models`
  with Bearer; 401 → invalid; ok → valid; network fail → unknown.
- `packages/web/src/settings/provider-status.ts`: per-`id` branch in
  `providerDescription` — "Fast compaction only. Never used for chats."
  (`ProviderRow` renders any non-`cli` entry via `ApiProviderRow` from `methods`,
  so the row otherwise works unchanged.)
- `real-models.ts`: **no change** — no pi-ai provider is registered for Jev.

### 3. Setting (per-node, default off)

`SettingsSchema` (+ `settings-store.ts` parse/defaults/setter, + `Core["settings"]`
+ `settings-api.ts`):

```ts
compaction: Type.Optional(Type.Object({
  mode: Type.Union([Literal("summary"), Literal("fast")]),      // default "summary"
  backend: Type.Union([Literal("auto"), Literal("typesafe"), Literal("openai")]), // default "auto"
}))
```

Optional so an older node still validates (response-validated). Enabling `fast`
with zero available backends → `invalid_request` (server enforces; web dims
anyway so this is a backstop, not the UX).

### 4. Availability status over the wire

Preferred: optional field on the already-polled `ProviderInfo` (web polls
`providers.list()` and invalidates on `providers` changes — no new
method/route/query key):

```ts
decisions?: Type.Union([Literal("ready"), Literal("unavailable"), Literal("checking"), Literal("unknown")])
```

Set for `typesafe` (own key state) and `openai` (probe result); absent elsewhere.
The probe is async/network, so compute off the `list()` hot path: cache +
`unknown`-by-default. Protocol bump is **mandatory, not conditional** (any
`ProviderId` literal / `Settings` field / route changes `PROTOCOL_VERSION` — run
the documented `bump-protocol`). `LINK_PROTOCOL` is unaffected (base frames
only): nodes still link; only the update banner path triggers.

### 5. Harness hook (new file, e.g. `packages/core/src/harness/fast-compaction.ts`)

A `defineExtension` installed in `registry.ts` (`createAgentRegistry`) exposing
`CompactionHooks.beforeCompact`:

1. If `compaction.instructions !== undefined` → `return undefined` (a focused
   manual compact defers to the built-in summarizer, which honors instructions).
2. Read setting; `mode !== "fast"` → return `undefined` (built-in runs).
3. Convert `entries`/`messages` before the cut into frames; one frame = one
   assistant tool-call block + its result entries (kept/dropped together).
4. Pin: first message + newest `preserveRecentMessages` (default 6, match
   upstream) — never scored.
5. Ask `predicate` ×2 per unpinned frame (keep call / keep full result),
   batched + concurrent (Jev evaluates all questions against one state in
   parallel; same for OpenAI).
6. Decide in code: `p > keepThreshold` (default 0.5, per-backend tunable after
   spike) keep verbatim; middle → truncate result to `truncateHeadChars`
   (default 300) + note; low → drop.
7. Render verbatim structured summary (user/assistant text as-is, dropped calls
   omitted, truncated results head + note, `decisions:` diagnostic dump) and
   return `{ summary }`. Respect `minReductionRatio` (default 0.25): below it
   on a manual/threshold run, either `return undefined` (simplest, keeps a
   summary) or `decline` (deliberate skip — expect `nothing_to_compact` on
   manual). NEVER decline on `overflow`.
8. Any no-key / error / timeout / unfittable history / abort → `return undefined`.
   Never half-apply. A throwing hook is reported via `onReport` and falls
   through to built-in, but prefer explicit `return undefined`; don't rely on
   throw. Every decisions fetch gets its own timeout
   (`AbortSignal.any([AbortSignal.timeout(X), context.abortSignal])` or manual
   race) — the framework enforces no hook timeout, and a hanging fetch would
   hang compaction indefinitely.

### Hook construction (mechanism)

Typed `HookApi` is only committed reads + memos + `models` — no settings, no
credentials, no env, no fetch. So the extension is built by a factory wired in
`createCore` (precedent: `createTauCodingTools(home, services)`), closing over
real services:

```ts
makeFastCompactionExtension({ settingsStore, credentials, env, fetchFn })
```

- Tau setting + TypeSafe key: from closures (`credentials.read("typesafe")` →
  `env.TYPESAFE_API_KEY`; `FileCredentialStore.read` returns `undefined` for
  unknown ids, no throw).
- OpenAI key: via typed `api.models.getAuth("openai")` → `.auth.apiKey`
  (covers stored + env keys through pi-ai's `authContext`). No closure needed.
- `keepRecentTokens`: pass through closure config (don't duplicate it as a
  tau knob). Other thresholds (`keepThreshold`, `truncateHeadChars`,
  `minReductionRatio`) are tau-side knobs, tuned per backend in the spike.
- Install via `registry.install()` in `createAgentRegistry`; hooks fire for the
  conversation's selected extensions (default: all installed). Verify at
  implementation time that subagent-spawned conversations resolve through the
  same registry.

### 6. Web: agent-settings row (always visible, dimmed when unusable)

In `AgentSection` (precedent: `ResourcesGroup` gated group):

- No compatible backend → `Switch`/`SegmentedControl` disabled + tooltip:
  "Connect TypeSafe, or OpenAI with decisions access, to enable fast compaction."
- Backend(s) ready → enabled; status line lists per-backend state; backend picker
  (`auto` default) beside the toggle. Default off — user opts in.
- Last backend disconnected while on → row dims again with a note; setting
  stays; compactions fail soft to summary.

Use only `packages/web/src/components/ui` primitives (shadcn first).

## Test plan

- `validators.test.ts`: typesafe 200/401/network-fail mapping (mock fetch).
- `provider-service.test.ts`: empty-`piProviders` set/disconnect round-trip under
  credential key `"typesafe"`; `isConfigured()` false with only TypeSafe;
  `listModels()` gains no models.
- `settings-store.test.ts` + settings-api tests: defaults (`summary`/`auto`),
  invalid values rejected, enabling `fast` with no backend → `invalid_request`.
- `decisions/` unit tests with fake transports: thresholds, truncate/drop/keep
  boundaries, batching, timeout/probe-unavailable mappings.
- Contract suite: `packages/testkit/src/contract/providers.ts` asserts the exact
  id list — update `PROVIDER_IDS` with `"typesafe"` + round-trip cases
  (set/disconnect under credential key `"typesafe"`, `isConfigured()` false
  with only TypeSafe, `models.list()` gains nothing). Runs against faux and real
  targets — not covered by unit tests alone.
- e2e asserts: decline never fires on overflow; manual-compact-with-dead-backend
  falls back to a placed summary (no `nothing_to_compact`).
- Harness hook tests with fake `DecideClient` (no network): pinning, frame
  grouping (call+results atomic), min-reduction → `undefined`, instructions →
  `undefined`, error/timeout → `undefined`; deliberate-skip `decline` asserted
  only for the manual/threshold case (expecting `nothing_to_compact`).
- e2e (follow `fast-jev-compaction-pi` pattern): mock Jev + mock decisions
  servers on localhost, drive compaction through RPC; scenarios: drop-all,
  keep-all, second compaction continuity, `MOCK_FAIL=500` → built-in fallback.
- `check` (biome + `tsc --noEmit`), `test` (vitest), `build` per repo commands.
- Spike first (before committing to defaults): real keys on seeded sessions —
  reduction %, memory-QA retention, latency/cost per backend; tune
  `keepThreshold`/`truncateHeadChars`/`minReductionRatio` per backend.

## Rollout

1. Spike + tune (no UI): hook + `DecideClient`s behind setting, fake-first.
2. Provider row + validator + credential/env fixes.
3. Setting + `ProviderInfo.decisions?` status field + mandatory `bump-protocol`.
4. Web row (dimmed/tooltip/enabled states).
5. e2e + docs copy; announce in release notes as opt-in beta.

## Spike-first validation (load-bearing externals — confirm or kill)

Unverifiable from this repo; the spike confirms before implementation commits:

- TypeSafe `POST /v1/systemone` + `noul` shape + `GET /v1/models` validation + pricing.
- **OpenAI Decisions `POST /v1/decisions` + `gpt-6-luna` + `predicate → probability`**
  exists as documented. If not, `openai.ts` dies and `auto` = typesafe-or-nothing.
- Per-backend threshold semantics (Jev RLCD-calibrated vs OpenAI predicate).

## Open questions (spike answers)

- `auto` order when both backends ready (measure cost/latency/retention first).
- Exact per-backend thresholds (Jev RLCD-calibrated vs OpenAI predicate — tune
  separately, don't share one number blindly).
- Probe TTL + where the availability cache lives (in-memory vs persisted).

## Non-goals

- Per-request (`beforeRequest`) continuous pruning — phase 2.
- Safety gating (`rm -rf` blocking) in the same pass — noted, not this plan.
- Claude Code plugin parity (full transcript replace) — impossible on Pi's
  append-only compaction; not claimed.
