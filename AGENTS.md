# tau

Chat with a coding agent that works in your project folders, from the browser.

## Commands

* Run pnpm only as `mise exec -- pnpm <command>`. Never npm, yarn or bare pnpm.
* `check`: Biome and `tsc --noEmit` in every package (`format` fixes). `test`: Vitest. `build`: web, then the CLI. `e2e`: Playwright on the built CLI.
* Web without a backend: `VITE_FAKE=1 mise exec -- pnpm --filter @tau/web dev` (add `?fake=ready` to skip setup).
* zsh has noclobber: use `>|` to overwrite a file.

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
2. Write a plan doc.
3. Adversarial review rounds with evidence (`file:line`, command output). Repeat until approved.
4. One foundation agent freezes the contract, stubs and fake. Done when check, test and build pass.
5. Parallel agents, each owning folders. The plan lists who owns what. Nobody edits files they do not own. Needed changes go in a note for the integrator.
6. One integration agent applies the notes and merges each branch as it finishes. It runs check and test after each merge.
7. Verify for real: run the built app in a browser and use it with real user actions.

* Agents run on Sonnet with low effort.
* Never work around git hooks. If a hook blocks git, leave work uncommitted and say so.
* Announce each finished step with `say`.
