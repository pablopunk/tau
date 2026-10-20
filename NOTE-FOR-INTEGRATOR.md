# NOTE FOR INTEGRATOR (hook-live-decision-clients)

## Foundation was NOT on this branch — cherry-picked in

The assignment said foundation had landed, but `pi/hook-live-decision-clients`
was at `ae9718d` with no `decisions/` folder and no `PLAN-jev-compaction.md`.
The foundation commits live on `pi/look-into-jev-compaction-with-typesafe-a`
(`b9cccac`). I cherry-picked the six foundation-only commits in order
(`0e90eb5 cf35a10 385a39e 5c0077d dd98e83 b9cccac`):

- One conflict in `packages/protocol/src/protocol-hash.ts` (took theirs, then
  re-ran `bump-protocol` at the end — hash is current).
- One conflict in `packages/core/src/home/settings-store.test.ts` (kept BOTH
  new `it` blocks: the legacy-migration test and the compaction-defaults test).

If the integrator re-merges the foundation branch instead, expect a duplicate
 Preparations — the cherry-picked commit hashes are `c0fda40 1f58e0d fbc2e1b
 6d52433 0f41617 ea5c7fd`; drop one side.

## Pre-existing failures (NOT mine — identical with my files stashed)

- `packages/core/src/home/settings-store.test.ts` (11) +
  `packages/core/src/processes/process-governor.test.ts` (3): the foundation
  settings expectations (e.g. `heavySlots`/`memoryLimitMb` in test DEFAULTS)
  disagree with this branch's resource-collapse implementation. Needs a
  foundation-owner rebase of the test DEFAULTS.
- `packages/web` (12 across palette/settings-search/ResourcesGroup): fail on a
  clean tree too; resource-branch vs foundation interplay.

My suites pass: `decisions/*`, `harness/fast-compaction.test.ts` (8),
`provider/*` (incl. `provider-service.test.ts` contract neighbors), plus
protocol/testkit/server packages fully green. `build` passes; `typecheck`
passes in every package; biome clean on all my files.

## Deliberate semantic choices (review-relevant)

- `decline` is NEVER returned by the hook — even the deliberate-skip case uses
  `return undefined` (built-in still places a summary). Rationale: `undefined`
  satisfies "deliberate skip on manual/threshold" without risking
  `nothing_to_compact`; overflow can never decline by construction.
- Hook never probes: `availability.peek` only skips already-demoted backends;
  anything else tries live, failing soft to the next backend → `undefined`.
- `auto` order is `[typesafe, openai]` (cheapest first); explicit backend pins
  one with the other as soft fallback (a dead pinned backend still ends at
  `undefined`, never an error).
- `isDecisionsNotFound` matches the `(404)` marker live clients put in error
  messages (AppError has no status field; no new error codes were added).
- Test seam `decideClients` skips the key/peek gate so hook tests exercise
  scoring, not key plumbing.

## Threshold defaults (plan values, untuned — spike still open)

`preserveRecentMessages = 6`, `keepThreshold = 0.5` (both questions above →
keep; one above → truncate; else drop), `truncateHeadChars = 300`,
`minReductionRatio = 0.25`, `predicateTimeoutMs = 60_000` (clients also carry
their own 30 s `AbortSignal.timeout`).
