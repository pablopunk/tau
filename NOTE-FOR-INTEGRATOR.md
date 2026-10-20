
---

# NOTE-FOR-INTEGRATOR (e2e fast-compaction)

Files I own (only these): `e2e/tests/fast-compaction.spec.ts`,
`e2e/tests/fast-compaction-mocks.ts`. I did not touch `packages/core` or
`packages/web`.

To run my spec: `mise exec -- pnpm build` once (playwright `webServer` needs
`packages/cli/dist`), then
`mise exec -- pnpm --filter @tau/e2e exec playwright test tests/fast-compaction.spec.ts`.
9/9 green on this worktree (2026-10-20). `pnpm --filter @tau/e2e typecheck`
clean, `biome check` on both files clean.

## What I had to merge

Foundation was not in my branch (`pi/e2e-mock-compaction-scenarios` was based
at `ae9718d`). I merged `pi/look-into-jev-compaction-with-typesafe-a`
(= `b9cccac`) into my branch to compile against the landed API, resolving two
conflicts: kept BOTH tests in
`packages/core/src/home/settings-store.test.ts` (resources migration + the
compaction-defaults test) and rebumped the protocol hash
(`pnpm --filter @tau/protocol bump-protocol`; protocol tests pass).

## MUST-AGREE seams with the hook agent (hook not landed here)

My spec passes backend URLs via core env, but the live `DecideClient`s are
still stubs, so nothing reads them yet. The hook MUST support these (or tell
me the real names and I'll rename the two constants at the top of the spec):

- `TAU_TYPESAFE_BASE_URL` — spec sets it to `<mock>/v1/systemone`.
- `TAU_OPENAI_DECISIONS_URL` — spec sets it to `<mock>/v1/decisions`.
- `MOCK_FAIL=500` is honored per-request by my mocks (no restart needed).

Response shapes my mocks serve (superset, so any reasonable parser finds the
score — confirm or narrow once the hook's parser is fixed):

- TypeSafe `POST /v1/systemone` (only this path; others 404):
  `{ model, probability, answers: { keep: { type: "noul", probability } }, data: { keep: { probability } } }`
- OpenAI `POST /v1/decisions` (only this path; others 404):
  `{ model, probability, output: [{ type: "predicate_result", probability }], data: { probability } }`

Request shapes parsed are the foundation builders
(`typesafePredicateBody` / `openaiPredicateBody`); hits log
`{ backend, input, instructions, probability }` for hit-count assertions.

## Tighten once the hook lands (marked `INTEGRATOR` in the spec)

- drop-all: assert `typesafe.hits.length > 0` and pruned content omitted.
- keep-all: assert `openai.hits.length > 0` and kept content verbatim.
- continuity: tighten `>=` to `>` on hit counts across the second compaction.
- Plan §5 `decline` semantics are asserted as fallback behavior throughout
  (summary placed, never `nothing_to_compact` / run failure); the deliberate
  `decline` path (manual/threshold only, never overflow) belongs to the hook
  agent's harness tests, not e2e. True `overflow` reason can't be forced
  deterministically here — the "dead backends never fail a threshold
  compaction" test is the closest deterministic auto-compaction trigger.
