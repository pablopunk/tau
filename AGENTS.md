# tau

Chat with a coding agent that works in your project folders, from the browser.

## Commands

* Run pnpm only as `mise exec -- pnpm <command>`. Never npm, yarn or bare pnpm.
* `check`: Biome and `tsc --noEmit` in every package (`format` fixes). `test`: Vitest. `build`: web, then the CLI. `e2e`: Playwright on the built CLI.
* Web without a backend: `VITE_FAKE=1 mise exec -- pnpm --filter @tau/web dev -- --port <free-port> --strictPort` (always pass an explicit free port with `--strictPort`: without it Vite silently bumps to the next free port and you may open another agent's tree. Add `?fake=ready` to skip setup, `&nodes` to link two fake nodes; `?fake=setup&nodes` is an unconfigured node with peers).
* * zsh has noclobber: use `>|` to overwrite a file.

## Packages

* `protocol`: TypeBox schemas, the `Core` interface, errors. No internal dependencies.
* `testkit`: fixtures, a fake `Core`, the contract suite.
* `core`: implements `Core` on Pi Durable. Only `core/src/harness/` imports Pi Durable.
* `server`: Fastify. HTTP and WebSocket to `Core` calls. No business logic.
* `web`: React, Vite, Tailwind, shadcn/ui, TanStack Query.
* `cli`: the published `tau` package.

Dependencies point one way: `protocol` <- `testkit` <- `core`, `server`, `web`. `core` never imports `server`.

## Conventions

* TypeScript strict, ESM only, `import type` for types.
* Small files. Use small well-named functions, not comments.
* Expected failures are `AppError` with a code from `protocol/src/errors.ts`.
* Every REST body and WebSocket frame is a TypeBox schema.
* Commit often. Fix causes, not symptoms.

## Design system

* Build UI only from `packages/web/src/components/ui` (shadcn first). No one-off styled elements.
* If a piece is missing, add it there first, then use it.

## Subagent workflow

1. Talk with the user. Agree on scope.
2. Write a plan doc in `plans/`.
3. Adversarial review rounds with evidence (`file:line`, command output). Repeat until approved.
4. One foundation agent freezes the contract, stubs and fake. Done when check, test and build pass.
5. Parallel agents, each owning folders. The plan lists who owns what. Nobody edits files they do not own. Needed changes go in a note for the integrator.
6. One integration agent applies the notes and merges each branch as it finishes. It runs check and test after each merge.
7. Verify for real: run the built app in a browser and use it with real user actions.

* Never work around git hooks. If a hook blocks git, leave work uncommitted and say so.
* Announce each finished step with `say`.

## Subagent context contract (isolated worktrees only see tracked files)

A subagent in an isolated worktree cannot see untracked or gitignored files (`plans/`, scratch notes, local
fixtures). Never reference such a path bare in a subagent prompt — it does not exist for them.

Parent side: state `base: <branch>@<shortSHA>`; tag each referenced file `[REQUIRED]` or `[OPTIONAL]`;
inline ignored/untracked content (tight excerpt + `Omitted:` line ranges) instead of its path.

Subagent step zero, before any other work, reply with a filled `CONTEXT_CHECK` (base FRESH/STALE, each
file OK/MISSING): any REQUIRED gap (or STALE checkout on a review task) is verdict BLOCKED — stop and
request the inline content. Otherwise PROCEED_WITH_GAPS listing the gaps. STALE with zero
`git diff --name-only` overlap with the task scope may proceed with the skew noted.
