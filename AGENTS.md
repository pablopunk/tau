# pi-everywhere

Chat with a coding agent that works in your project folders, from the browser. Plan: `PLAN.md`. MVP spec: `MVP.md` (the source of truth for architecture, protocol and security).

## Commands

* Run pnpm only as `mise exec -- pnpm <command>`. Never npm, yarn or bare pnpm.
* `pnpm check`: Biome (lint + format, `pnpm format` fixes) and `tsc --noEmit` in every package.
* `pnpm test`: Vitest in every package. `pnpm build`: web, then the CLI bundle. `pnpm e2e`: Playwright against the built CLI in faux mode.
* `pnpm fixtures`: re-records `packages/testkit/fixtures/*.json` with the real Harness and the faux script. Only the integrator runs it.
* Web without a backend: `VITE_FAKE=1 mise exec -- pnpm --filter @pi-everywhere/web dev` (add `?fake=ready` to the URL to start past setup).
* zsh has noclobber: use `>|` to overwrite a file from the shell.

## Packages

* `protocol`: TypeBox schemas (REST routes, WebSocket frames, errors), the `Core` interface (`src/core.ts`), re-exported Pi view types. No internal dependencies.
* `testkit`: recorded fixtures, a browser-safe fake `Core`, and the contract suite `runCoreContract` (`@pi-everywhere/testkit/contract`). Exports TypeScript source.
* `core`: implements `Core` on Pi Durable. Only `core/src/harness/` imports `@earendil-works/pi-durable`. Stub today: `createCore`.
* `server`: Fastify. Translates HTTP and WebSocket to `Core` calls, security, static files. No business logic. Stub today: `createServer`.
* `web`: React 19, Vite, Tailwind v4, shadcn/ui, TanStack Query. Imports Pi only as types, except `@earendil-works/chord/delta`.
* `cli`: the published `pi-everywhere` package. tsdown bundles the workspace packages, Pi packages stay external.

Dependencies point one way: `protocol` <- `testkit` <- dev dependency of `core`, `server`, `web`. `core` never imports `server` or Fastify.

## Parallel work

* Phase 1 agents never edit `package.json`, `pnpm-lock.yaml`, `packages/protocol/**` (including the `Core` interface), `packages/testkit/**`, or files another workstream owns. `protocol` and `testkit` belong to the integrator.
* A needed contract change is a short note in `CONTRACT-CHANGES.md` (what, why, the exact change). The integrator applies it.
* Each workstream commits only inside its own folders, in small commits, with tests green before each commit.
* Ownership: A `packages/core/src/**` except `testing/**`; B `packages/server/**` and `packages/cli/**`; C `packages/web/src/{app,routes,setup,sidebar,lib}` except `lib/api.ts` and `lib/transport/**`; D `packages/web/src/conversation/**`.

## Design system

* Build every UI feature only from design system components (`packages/web/src/components/ui`, shadcn/ui on our theme tokens). No one-off styled elements or raw Radix in feature code.
* If a feature needs something the design system lacks, add it to the design system first (a reusable component on the theme tokens), then use it from the feature.

## Conventions

* TypeScript strict, ESM only, extensionless relative imports, `import type` for types (Biome enforces it).
* Small focused files. Prefer well-named small functions over comments; keep a comment only for a non-obvious invariant or an upstream workaround.
* Expected failures are `AppError` with a code from the closed union in `protocol/src/errors.ts`.
* Every REST body and WebSocket frame is a TypeBox schema, validated on both sides.
* Commit often. Fix causes, not symptoms.
