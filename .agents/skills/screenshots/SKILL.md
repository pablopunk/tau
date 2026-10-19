---
name: screenshots
description: Regenerate the README screenshots (thread with subagents, diff, phone thread, phone sidebar) from the latest tau UI using the faux server, made-up projects and scripted replies. Use when the user asks to refresh, redo, or regenerate screenshots, or says "new screenshots".
---

# Tau screenshots

Run `mise exec -- pnpm screenshots` from the repo root. It builds the app, starts the real server with `--faux` on a free port, seeds it, drives Chromium with Playwright and writes `diff.jpg`, `phone-thread.jpg` and `phone-sidebar.jpg` into `assets/screenshots/`. The README references them by those names.

Options: `--only <scene>` (repeatable; scenes are `diff`, `phone-thread`, `phone-sidebar`), `--skip-build`, `--out <dir>` (preview before replacing the README images).

Needs Playwright's Chromium (`pnpm exec playwright install chromium` in `e2e/`). Nothing real is read: the server runs with a temp `HOME` and a temp tau home, so your projects, threads and keys never appear.

## How it works

- `e2e/screenshots/environment.ts` creates real git repos for the made-up projects, starts `packages/cli/dist/bin.js serve --faux`, signs in with the token, and seeds the server over REST: provider key, default model, projects, then one thread per entry of `THREADS` (waiting until each stops running).
- The faux model plays `TAU_FAUX_REPLIES`, a JSON file of `prompt -> steps` written from `demo.ts` (`packages/core/src/testing/faux-replies.ts`). A step is thinking, text and any number of tool calls; the next model call plays the next step. Tools run for real in the project folder, so diffs and test output are genuine. Prompts without an entry fall back to the generic faux script.
- Subagents are `agent` tool calls with `run_in_background: false`. The child thread's prompt is looked up in the same table, so it needs its own entry in `SUBAGENT_REPLIES`.
- `scenes.ts` holds the scenes. Desktop is 1280x800 at 2x, phone is the iPhone 15 Pro profile at 2x.

## Changing the content

- Projects, files, prompts and replies: `e2e/screenshots/demo.ts`. Threads start in order, so the last one is on top of the sidebar.
- Scenes and click steps: `e2e/screenshots/scenes.ts`.

## Gotchas

- The CLI is built, so rebuild before capturing (the command does unless `--skip-build`), or core changes such as faux replies are missing.
- The model shows as "Faux One" because it is the faux provider.
- Before committing, open every image and reject any that is empty, mid-animation or shows a stale UI. A command that exits 0 is not proof. Use `sips -Z 1400 in.jpg --out /tmp/new-name.jpg` to shrink them for viewing, with an output name that does not exist yet.
