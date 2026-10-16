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
* Ownership (MVP2, see `MVP2.md`):
  * A1 core conversations: `packages/core/src/{conversations-api,conversation-title,conversation-recovery}.ts`, `harness/{conversation-store,conversation-docs}.ts`, `titles/**`, `status/**`.
  * A2 core projects, settings, git: `packages/core/src/{projects-api,settings-api,resolve-project-folder}.ts`, `harness/{project-store,projects-doc}.ts`, `home/settings-store.ts`, `provider/**`, `git/**`.
  * B server and CLI: `packages/server/**`, `packages/cli/**`.
  * C web shell: `packages/web/src/{app,routes,setup,lib}` except `lib/api.ts`, `lib/transport/**` and the frozen files (`lib/paths.ts`, `lib/queries.ts`, `lib/use-changed-invalidation.ts`, `lib/preferences.ts`, `lib/hotkeys.ts`, and the placeholder mounts in `routes/MainLayout.tsx`). C replaces `routes/NewThreadPage.tsx` and `setup/` placeholders; E replaces the placeholders in its folders; D replaces `conversation/Composer.tsx` keeping `ComposerProps`.
  * D web conversation: `packages/web/src/conversation/**`.
  * E web navigation: `packages/web/src/{sidebar,palette,notifications,activity}`.
  * Integrator only: `packages/core/src/{testing/**,create-core.ts}`, `package.json` files, `pnpm-lock.yaml`, `packages/{protocol,testkit}/**`, `packages/web/src/lib/{api.ts,transport/**}`. Ask through `CONTRACT-CHANGES.md`. Shared design system (`packages/web/src/components/ui/**`): any owner may add a component, nobody changes an existing one in a breaking way. `core/src/test-support/**` and the core test files belong to A1 (chat) and A2 (projects, settings, provider).
  * Ownership (MVP3, see `MVP3.md`; Phase 0 is done, the integrator only edits the frozen files):
    * A1 core GitHub: `packages/core/src/github/**`, `git/{repository-key,clone-service}.ts`, `harness/project-store.ts` duplicate checks, the settings suggestion (`github/code-folder.ts`).
    * A2 core icons: `packages/core/src/icons/**` only.
    * B server: `packages/server/**` (icon, GitHub and image routes: limits, CSP, tests).
    * C web project menu and settings: `routes/ProjectPicker.tsx`, new `github/**`, settings rows.
    * E web sidebar and icons: `sidebar/**`, new `icons/**` (Change icon dialog).
    * Fake `gh` (`core/src/test-support/fake-gh*`, `gh-argv.ts`) is shared by core tests and e2e: change it only through the integrator.
  * Contract suite: remove your own `[tag]` entries from the pending lists in `packages/core/src/contract.test.ts` as you implement them (A1: start, images, titles, status, archive, delete, retry, listAll; A2: clone, settings; MVP3: A1 `[github]`, A2 `[icons]`).

## Design system

* Build every UI feature only from design system components (`packages/web/src/components/ui`, shadcn/ui on our theme tokens). No one-off styled elements or raw Radix in feature code.
* If a feature needs something the design system lacks, add it to the design system first (a reusable component on the theme tokens), then use it from the feature.

## Conventions

* TypeScript strict, ESM only, extensionless relative imports, `import type` for types (Biome enforces it).
* Small focused files. Prefer well-named small functions over comments; keep a comment only for a non-obvious invariant or an upstream workaround.
* Expected failures are `AppError` with a code from the closed union in `protocol/src/errors.ts`.
* Every REST body and WebSocket frame is a TypeBox schema, validated on both sides.
* Commit often. Fix causes, not symptoms.
