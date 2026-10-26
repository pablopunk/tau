# PLAN: subagent model guidance (rev 4)

Created 2026-10-20. Goal: an agent spawning a subagent can pick a model by task fit
(light for bulk work, heavier only when needed) on **any** provider, from facts we already
hold, with no new data provider and no drift from what pi-ai ships.

Rev 4 answers review rounds 1-3. Changes since rev 2 are marked **[R2]**, rev 4 text fixes **[R3]**.

## Verified starting point (file:line, checked in round 1 unless noted)

- Prompt section `subagent-models` = `modelsGuidance` (`packages/core/src/harness/tools/agent-models.ts:21`);
  bare `- provider/modelId` lines, capped by `MODEL_LIST_CAP = 40` (`:4`, applied `:15`).
- Agents are told **not to choose**: `agent-models.ts:23` and `agent-description.ts:7`
  ("Pick another one only when the user asked"). Effort: `THINKING_GUIDANCE` (`agent-thinking.ts:13-14`).
- `connectedModels` strips to `{provider, modelId}` (`create-core.ts:300`, type `tool-file.ts:16`).
- `ModelInfoSchema` (`entities.ts:25`) has no cost. `toModelInfo` (`model-list.ts:13`) drops `model.cost`.
- Same-provider rule: `resolveModelAlias` (`model-alias.ts:55`); pi provider id is the boundary
  (`opencode` = Zen pay-per-token, `opencode-go` = subscription; different products).
- `fast` resolves to the settings fast model only on the parent's provider, else silently the parent
  (`model-alias.ts:59`). The prompt never says what `fast` maps to.
- **[R1] Corrected:** claude-cli rows hardcode `cost: {0,0,0,0}` (`claude-cli-model-row.ts:35`);
  the Anthropic catalog is only used for `input`/`contextWindow`/`maxTokens` (`claude-cli-models.ts:24-25`).
  Faux models set no cost and pi's faux provider defaults it to 0/0 (`pi-ai/dist/providers/faux.js:345`;
  `FAUX_MODELS`, `faux-provider.ts:15-19`).
- **[R3] Measured in pi-ai 1.3.0 catalogs** (chat models with cost 0/0; see the round-2 note below for the exact
  non-free entries): anthropic 0, openai 0, google 2 (gemma), openrouter ~21 `:free` plus 7 free-looking routers,
  opencode ~11 (`*-free`, `big-pickle`), opencode-go 3 (all `-free`). **0/0 alone never proves free;** the id rule
  `isFreeId` (Design section 1) is the only free signal.

## What data exists

| Axis | Source | Verdict |
|---|---|---|
| Cost | pi-ai catalog `cost` | Real for anthropic/openai/google/openrouter/opencode/opencode-go. **Not** claude-cli or faux (placeholder zeros). |
| Free | `isFreeId` (0/0 **and** id suffix rule) | Design section 1. |
| Context / reasoning / thinking levels | `ModelInfo` | Have it. |
| Billing kind | per pi provider: usage vs subscription | New flag. |
| Smartness | none objective (models.dev has no benchmarks; Artificial Analysis is key-gated, misses much of Go, not offline) | Proxy only. |
| Speed | none | No latency data. Levers: lighter model, lower `thinking`. |
| Go req/5h and $ caps | opencode.ai/go table | Real but static, plan-specific, rotates. **Deferred (v2).** |

Rule: **show facts, label proxies as proxies, never invent a score.** The parent model already
knows what haiku/opus/flash mean; we supply what it cannot know (exotic Go/OpenRouter models) and billing meaning.

Constraint: stay aligned with pi. No live id overlay, no extra catalog. Catalog freshness is pi-ai
freshness (Dependabot group + auto-merge, already committed).

**[R2] Round-2 measurement (reviewer, chat group only):** openrouter has 7 non-`:free` 0/0 entries
(`auto`, `openrouter/auto`, `auto-beta`, `free`, `fusion`, `pareto-code`, `typesafe/jev-router`); opencode has
`big-pickle` and `jev-1.13-free`. So an id-suffix rule is the only safe free signal, not "0/0 on a trusted source".
(Counts differ by one for openai/opencode depending on whether image models are counted: irrelevant to the rule.)

## Design

### 1. Plumb facts (protocol + core + testkit)

One mechanism for "no price": **`cost` absent = unpriced**. No provider-level `prices` flag. **[R2]**

- `ModelInfo` gains optional `cost: {input, output}` ($/MTok, base tier, `tiers` ignored) and optional
  `billing: "usage" | "subscription"`. Optional: older nodes validate (precedent `Settings.resources`);
  `ModelInfoSchema` is not closed (only `updates.ts:41` is).
- **Free rule (single function `isFreeId`, new, in `model-list.ts`'s folder):** a model is free iff catalog cost is
  exactly 0/0 **and** its id ends in `:free` or `-free`, or equals the named constant `KNOWN_FREE_IDS` (`big-pickle`). A catalog test asserts every `KNOWN_FREE_IDS` entry still exists in pi's opencode catalog and fails loudly if pi renames it. **[R3]** Everything else with 0/0 (routers like
  `auto`, `openrouter/free`, `fusion`; google gemma; faux; claude-cli rows) is **unpriced**. Conservative on purpose:
  a missing "free" label costs nothing, a wrong one burns quota. **[R2]**
- `toModelInfo(model, ref)` takes the `PiProviderRef`-shaped `{label, billing}` instead of a bare name
  (`model-list.ts:13`; callers `:66`, `:83`, `:86`). It sets `billing = ref.billing` and `cost` per rule: positive
  cost -> emit it; 0/0 and `isFreeId` -> emit `{0,0}`; else omit. For the faux and claude-cli paths
  (`listFaux`, `model-list.ts:77-88`) the lister builds two local refs: `{label: "Faux", billing: "usage"}` and
  `{label: CLAUDE_CLI_PROVIDER_NAME, billing: "subscription"}`. **[R2]**
- `PiProviderRef` (`providers-table.ts:12`) gains `billing`: opencode, openrouter, anthropic, openai, google =
  usage; opencode-go = subscription.
- claude-cli price: its `Model.cost` stays 0/0 (pi usage accounting). The row builder already resolves the Anthropic
  catalog entry (`claude-cli-model-row.ts:27`); `ClaudeCliModels` records `{input, output}` of that entry in a side
  map exposed as `priceOf(modelValue)`, threaded to the lister next to `claudeCliModels`
  (`provider-service.ts:112`) as an optional `priceOverride` argument of `toModelInfo`. No catalog match -> no
  cost -> unpriced. Caption is subscription; ordering is by that list price. **[R2]**
- Faux: `FAUX_MODELS` (`faux-provider.ts:15-19`) get distinct fixture costs: `faux-1` 1/5, `faux-2` 3/15,
  `faux-fast` 0.1/0.5; `faux-text` none (exercises unpriced). Faux has no `-free` ids, so no free in faux; the unit
  tests for free use fixtures directly. **[R2]**
- `connectedModels` returns full `ModelInfo` (`create-core.ts:300`, `tool-file.ts:16`); `ModelInfo` is a superset of
  `ModelRef`, so `resolveModelAlias` and `subagent-test-support.ts:93,135-137` are unchanged.
- Web/testkit: every new field is optional, so existing fixtures (`ModelCombobox.test.tsx`,
  `new-thread-defaults.test.ts`, testkit catalog) compile unchanged. Only the testkit catalog and the web fake
  (`VITE_FAKE=1`) get a few costs so the fake exercises bands; the file is `packages/testkit/src/fake/catalog.ts`. **[R3]** Implementer greps both test files to confirm. **[R2]**

### 2. Bands (new small file `agent-model-bands.ts`, pure, unit-tested)

Input: the parent provider's `ModelInfo[]`. Output per model: `free | light | mid | heavy | unpriced`.
- `free` = `cost` present and 0/0. This is safe only because `toModelInfo` emits 0/0 solely for `isFreeId` models; band code must never re-derive free from price alone. `unpriced` = no cost. **[R3]**
- Priced = positive cost, n = their count, ranked by `input + output`, grouped by distinct price.
  **Pre-check [R3]:** if n < 4 or there is only one distinct price, every priced model is `mid` and the walk is skipped.
  Otherwise walk groups cheapest first with a running count `before` (models in cheaper groups) and
  `after = n - before` (models in this group and all dearer ones): `light` if `before < n/3`, `heavy` if
  `after <= n/3`, else `mid`. Ties always share a band; a group never straddles.
- Worked examples (also the unit tests): prices 1,1,1,1,1,1 -> all `mid` (nothing to split; price shown anyway);
  1,1,5,5,20,20 -> light, light, mid, mid, heavy, heavy; 1,2,3 (n<4) -> no bands, ordered, all `mid`;
  1,1,5,5,5,5 -> light, light, mid x4 (the big tie group has before=2, after=4, neither rule fires; ties never straddle); 1,1,1,5,5,5,20 (n=7) -> light x3, mid x3, heavy; only free -> all `free`; no priced -> all `unpriced`. **[R3]**
- Because collapse can hide the spread, every line also shows the real list price, so bands are a summary of
  facts the agent can read. **[R2]**

### 3. The guidance block (rewrite of `modelsGuidance`, and `agent-description.ts:7` in the same change)

- Header: provider, billing kind, caption:
  - usage: "heavier = more money per token".
  - subscription: "heavier burns your plan's usage window faster; free models burn none".
  - once: "price tracks capability loosely; a proxy, not a benchmark".
- Line: `- provider/id: band, $in/$out per MTok, ctx, reasoning`. Markers: `(your model)` on the parent, `(fast)` on
  the fast alias target, `(your model, fast)` when `fast` resolves to the parent. **[R2]**
- `Aliases:` `inherit` = your model; `fast` = `<ref>` only when it resolves on this provider, else "your own model".
- **Policy:** default to your own model. Go lighter (`free`/`light` plus low `thinking`) for search, summaries,
  mechanical edits, bulk fan-out. Go heavier when the task needs a smarter model (plan review, hard bug), even from a fast parent, using few heavy workers; an explicit user
  model or effort instruction always wins. If your own band is `unpriced`, keep your own model. If it is `free`, nothing is
  lighter: keep it. If everything collapses to `mid`, the rule is vacuous: read the prices. N workers multiply
  spend/quota by N. Speed: "no latency data; lighter model + lower thinking is the speed lever". The old "only
  when the user asked" sentence is removed from `agent-models.ts:23` and rewritten in `agent-description.ts:7` to
  the same rule so they cannot contradict. **[R2]**
- **List cap (no families, dropped in R2).** Always: parent, fast target. Then free models up to a sub-cap of 10
  (`... and N more free models` line if cut). Then fill to the existing total of 40 by taking up to `ceil(remaining/3)`
  per band in light, mid, heavy order, each band sorted by `naturalCompare` of the id descending (exported from
  `model-alias.ts:20`, today private). `unpriced` models last. Final line `... and N more` when cut, so the agent
  knows more exist and that `model` accepts any listed id or alias. Deterministic whatever the input order. **[R2]**
- Prompt-cache: the block now depends on catalog prices, billing and the settings fast model. A pi-ai bump changes
  the prefix once; accepted.

### 4. Out of scope for v1 (decided)

Go allowance table (rejected by the user: drifts), family-strength hints, 410 `ModelDeprecated` mapping.

## Phases

1. **Gate: print costs.** Script that prints `cost`, `isFreeId`, resulting band for every provider's catalog
   (anthropic, openai, google, openrouter personalised, opencode, opencode-go, claude-cli via `priceOf`, faux). Stop
   and revisit if a model labelled free is not in the reviewer's lists above.
2. **Plumb:** section 1. Done = `check`, `test`, `build` pass; compare `mise exec -- pnpm test` before/after so any
   contract-suite or `listModels` expectation change is intentional.
3. **Bands + guidance:** sections 2-3. Unit tests: band worked examples; free rule (openrouter `:free` yes, `auto`,
   `openrouter/free`, `fusion` no; opencode `-free` and `big-pickle` yes; google gemma no); cap rule on an
   OpenRouter-sized list with many free; fast line when `fast` is on another provider and when it equals the
   parent; policy text for parent `unpriced`/`free`. Snapshots of the block for Go-, OpenRouter- and Anthropic-sized
   lists, claude-cli and faux.
4. **Real use (definition of done):** built app, on the user's Go key and on claude-cli: ask for a bulk fan-out and
   a hard task; read `model` in `list_agents`; confirm light picks for bulk, heavier picks only for tasks that need them
   without an instruction, nothing outside the parent's provider. Playwright e2e still passes with faux costs.

One agent, serial: a small change crossing protocol/testkit/core.

## Non-goals

Live id overlay or our own catalog; prices in the web UI (possible later via `ModelInfo.cost`); merging Zen and
Go; method-level billing (OpenAI via ChatGPT login ships as usage); smartness or speed scores.

## Follow-ups (user, 2026-10-22)

### A. Malleable subagents: change model/thinking mid-chat

- The user can change a live subagent's model and thinking level mid-conversation, exactly like changing their
  own chat's model: same picker, same semantics (applies to subsequent steps, history preserved, no restart).
- A parent agent can do the same to its own subagents (update call on the live subagent id, same effect).
- Web: reuse the main composer model/thinking controls in the subagent row/panel, don't reimplement them.
- The section-3 policy stays per-spawn: each change re-evaluates "default to your own model, go lighter/heavier
  by task" from the subagent's own current model, not the top-level parent's.

### B. Nested subagents

- A subagent can spawn its own subagents, to a sane max depth (undecided, small single digit).
- The UI does not nest: only direct children are listed/shown; deeper levels are invisible in the sidebar and
  surface only through the parent's transcript and results.
- Cost rule compounds: N workers x M sub-workers multiply spend/quota; the guidance must say so when depth > 1
  is used. Same-provider rule applies per spawner.

## Decisions (user, 2026-10-20)

1. Policy flip: **approved**.
2. No code guard on fan-out in v1: **accepted**; revisit after the real-use check.
3. Go allowance table: **rejected** (would drift out of sync). We follow predictable catalog prices only.
