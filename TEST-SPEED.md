# Faster, smarter, better tests

Status: implemented (partial). Phases 0-4 landed on branch test-speed, PR #6; see Implementation status.

## Goal

1. **Faster:** push to result under 7 minutes after Phase 1; about 5 minutes after Phases 2 and 3 (today about 15).
2. **Smarter:** a local run on the owner's Mac runs only what a change touches. Full suites run in CI.
3. **Better:** no test waits a fixed time. Flaky tests are listed in every CI run and get fixed.

Non-goals: deleting tests, raising timeouts to hide slowness, changing what is tested.

## Measurements (CI run 39455101661, commit 92df33d)

- CI wall time: `verify` 4 min 45 s, then `e2e` 10 min 30 s (`needs: verify`). `verify` is serial: install 10 s, `check` 18 s, `test` 4 min 12 s, `build` 4 s, `smoke:binary` 31 s.
- Unit durations (packages run in parallel): web 179 s (environment 34%, import 23%), core 163 s, server 67 s, cli 20 s.
- Slowest unit files: `core/src/contract.test.ts` 79.5 s (207 tests), `web/src/app/App.test.tsx` 21.6 s, `core/src/timers/timer-scheduler.test.ts` 18.9 s, `web/src/sidebar/modes.test.tsx` 15.9 s, `server/src/nodes/link-streams.test.ts` 13.5 s.
- e2e: 25 specs, `workers: 1`, `retries: 1` in CI, one `webServer` on `PORT` 4399 (`e2e/support.ts:7`) with one `stateDir()`. First-attempt seconds: `mvp12-nodes` 87, `resources-live` 60, `mvp4` 38, `mvp8-timers` 34, `mvp6` 30, `resources` 22, `mvp13-step2-pins` 21, `mvp7` 20, `mvp8-restart` 16; the rest under 7. `binary` and `update-button` are unmeasured (they failed at 0 ms).
- `ci.yml` has no pnpm store cache and no Playwright browser cache.

## Phase 0: measure and check (before any change)

- One CI job that runs only `binary.spec` and `update-button.spec`, to measure their compile cost.
- Spike job: the Playwright container image, pinned to the exact Playwright version in `pnpm-lock.yaml`, runs `mise-action`, `setup-bun` (`.bun-version`), `pnpm install`, `tsx` and the cache restore (needs `tar` and `zstd`). Measure its setup time. If it fails or costs more than the non-container path, drop the container and use a cached `~/.cache/ms-playwright` plus `playwright install-deps chromium`. The Phase 1 target of under 7 min is confirmed only after this spike.
- Record the test counts (vitest and Playwright JSON reports) in `ci/test-counts.json` as the baseline. Count `numTotalTests` (skipped included) the same way for the baseline and for the shard sums.
- No per-spec matrix. `e2eRoot()` (`support.ts:71-86`) makes fresh state per `playwright` process, so the first sharded run shows any order dependence as a clear failure; fix those specs to be self-sufficient.

## Phase 1: CI layout (target under 7 min)

- `build` job: install, `pnpm build`, upload `packages/cli/dist` + `packages/web/dist`.
- After `build`, in parallel: `check`, `unit`, `smoke`, `e2e` (matrix of 4 shards).
- `unit` is a matrix of `{package, shard}` pairs: `core 1/2`, `core 2/2`, `web 1/2`, `web 2/2`, and `rest` (`server`, `cli`, `protocol`, `testkit`, unsharded). Each runs `pnpm --filter <pkg> exec vitest run --shard=N/M --reporter=default --reporter=json --outputFile=…` directly, so Phase 1 needs no new root scripts. Local `pnpm test` stays unsharded.
- e2e shards: assign files to shards by measured time, not file count, so `mvp12-nodes`, `resources-live` and the binary specs do not land together. Use `--shard` only if its split is balanced; otherwise one explicit file list per shard.
- Setup cost per job: cache the pnpm store; for e2e use the container or the browser cache, as the Phase 0 spike decides. `setup-bun` runs in every e2e shard (the binary specs compile with Bun).
- Reporters: e2e uses `blob` + `json` + `github`. Every shard uploads its reports with `if: always()`. A final `e2e-report` job (`if: always()`) runs `playwright merge-reports` and writes to the job summary the tests with status `flaky` (from JSON).
- Test count check: a `counts` job (`if: always()`) sums the per-shard JSON counts after all shards finish, then compares the totals to `ci/test-counts.json`. It fails if a count drops. A higher count passes and prints the new numbers. A commit that removes tests on purpose updates the file in the same commit.
- `ci-ok` job: `needs` all jobs, `if: always()`, fails unless every `needs.*.result` is `success`. This is the one required check.

## Phase 2: unit tests

- `contract.test.ts`: every contract case boots a full core (`createCoreWith` in `beforeEach`, `dispose` in `afterEach`) with a temp dir, git repos and fake gh: 207 boots in one worker. Split `runCoreContract` into one test file per contract module so vitest spreads them across workers. Same tests, same isolation. Then profile `createCoreWith` and `dispose` for cheap wins. No core is shared between mutating tests.
- Web: split `App.test.tsx` and `modes.test.tsx`; trim heavy imports in test setup. Try `happy-dom` instead of jsdom; keep only if all files pass. `isolate: false` and `vmThreads` are out of scope (setup.ts mutates globals, 48 files use `vi.mock`).
- Timer tests (`timer-scheduler`, `core-timers`): fake timers where they wait real time.

## Phase 3: e2e

- `mvp12-nodes`: `OFFLINE_AFTER_MS = 45_000` (`core/src/nodes/status.ts:4`); the test waits up to 55 s for the offline state (`mvp12-nodes.spec.ts:110`) and has a fixed 6 s sleep (`:187`). Add a test-only override for the offline delay and the heartbeat interval, honoured only when the tau home is under tmpdir (like `TAU_FAKE_*`), set to about 3 s in the spawned servers. Replace the 6 s sleep with a poll on the state it waits for.
- `resources-live`: the timeout test (`:76`) queues a command about 10 s with a 5 s timeout, then runs it 3 s. Scale these durations down together (same ratios), so the test still proves queue time is not counted.
- Remove every `waitForTimeout` (`resources.spec.ts`, `mvp8-timers.spec.ts`, `mvp12-nodes.spec.ts`); wait for the condition.
- Cache compiled binaries for `binary`/`update-button`, keyed on a hash of `packages/cli/dist` + `.bun-version` + target, if Phase 0 shows the compile is large.
- Optional later: a worker-scoped fixture that starts one faux server per Playwright worker, so `workers: 2` works inside a shard.

## Phase 4: local runs

- `pnpm test:changed`: `vitest related --run` on files changed against `origin/main`, only in changed packages.
- `pnpm e2e:one <spec>`: build once, run one spec.
- AGENTS.md: agents run `test:changed` and the specs they touch; full suites and e2e run in CI.
- After the flaky list stays empty for 10 runs on `main`, set e2e `retries: 0`.

## Owners

1. CI owner: `.github/workflows/**`, `ci/test-counts.json`, `e2e/playwright.config.ts` (reporters only). Phases 0–1.
2. Unit owner: `packages/*/vitest.config.ts`, `packages/core/src/contract*.test.ts`, `packages/testkit/src/contract/index.ts`, and the slow unit test files named in Phase 2 (`*.test.ts(x)` only). Phase 2.
3. e2e owner: `e2e/**` except the reporter lines, plus `packages/core/src/nodes/status.ts` (offline delay and heartbeat override) and one resources governor timing file under `packages/core/src/processes/governor/`. Before Phase 3 starts, the plan records which file. No `*.test.ts` files. Phase 3.
4. Integrator: root `package.json`, AGENTS.md. Phase 4.

Agents run only the files they touch locally. CI is the test.

## Done when

- Three green CI runs on `main` in a row: under 7 min after Phase 1, about 5 min after Phases 2–3.
- Test counts equal the baseline (checked by CI).
- Flaky list empty for those runs.

## Implementation status

Status: implemented (partial). Branch test-speed, PR #6, head 8a48e4f. Times are wall clock from job timestamps.

| | Before (run 39462593139) | After (run 39465184034, layout before the contract split) |
| --- | --- | --- |
| build | 33 s | 27 s |
| check | 22 s (fails on main: Biome lint in files this branch does not touch) | 25 s (same) |
| unit (core 1/2, core 2/2, web 1/2, web 2/2, rest) | 1 m 27 s to 1 m 43 s | 1 m 21 s to 1 m 25 s |
| smoke | 55 s | 51 s |
| e2e shards 1, 2, 3 | 3 m 38 s, 2 m 56 s, 3 m 25 s | 2 m 51 s, 2 m 39 s, 2 m 55 s |
| e2e shard 4 (binary, update-button) | 11 m 40 s | cancelled at 9 m 35 s (still compiling; binary fails on main anyway) |
| total (push to ci-ok) | 12 m 33 s | not finished (superseded by pushes) |

Governor file: not chosen; no resources governor change made.

Done:
- Layout: build once (dist tarball), check, unit (5 jobs), smoke, 4 e2e shards, e2e-report, counts, ci-ok.
- Test counts: baseline e2e 101 (old log "Running 101 tests"); unit baselines unchanged; ci/check-counts.mjs enforces them.
- Binary shard: fixed-folder releases cache (TAU_E2E_RELEASES_DIR), keyed on the CLI build. Not proven yet.
- Core contract split into 4 files over the same cases (testkit runCoreContract takes a module list).
- mvp12-nodes glare: fixed 6 s sleep replaced by a poll until each node lists one linked link.
- resources-live timeout test: holder 10 s to 5 s, timeout 5 s to 3 s, run 3 s to 2 s (queue still longer than timeout; run still shorter).
- Local runs: pnpm test:changed, pnpm e2e:one.
- Biome 2.5.15 applied to every changed file, verified with the pinned version via npx. The project node_modules is not installed locally, so pnpm exec biome ran 0.3.3 and reported nothing.

Not done, with reasons:
- Offline override (status.ts): skipped. Measured: the kill test takes 2 s, because the closed link marks the node offline at once. The 55 s wait the plan describes is no longer in the test, so an override saves nothing measurable.
- resources.spec.ts 7 s fixed wait (line 155) and 1.5 s wait (line 128): need a condition on the Off-path thread; not done.
- mvp8-timers.spec.ts:80 250 ms wait, resources-compare sleeps: not touched.
- Phase 0 container spike; Phase 2 web split (App.test.tsx, modes.test.tsx), happy-dom, timer fake timers.
- AGENTS.md; auto-merge-pi.yml still names verify/e2e.

Main failures left alone: Biome lint in files outside this branch, binary and update-button (systemctl --user in CI), mvp4, mvp5, mvp6, mvp9-connectors.
