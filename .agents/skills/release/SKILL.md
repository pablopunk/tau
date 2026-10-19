---
name: release
description: Release a new version of @pablopunk/tau (the `packages/cli` package) to npm. Use when the user says /release, "ship it", "publish", or asks to cut a version.
---

# Release @pablopunk/tau

Publishing is outward-facing: confirm the version bump with the user before tagging or pushing. The binary is still `tau`. If the repo has no `origin` or the package was never published, stop and tell the user: the first version (`0.1.0`) must be published by hand from a real terminal (`npm publish --access public` in `packages/cli`, with the authenticator code), without pushing a `v0.1.0` tag.

## Steps

1. Start from a clean `main` that is up to date with `origin/main`: `git status --short` is empty, `git fetch && git status -sb`.
2. Verify locally, unpiped (`pnpm check | grep …` returns grep's exit code and lets a type error through): `mise exec -- pnpm check`, `mise exec -- pnpm test`, `mise exec -- pnpm build`, `mise exec -- pnpm smoke:install`. Then run the e2e specs `terminal`, `mvp12-remote` and `mvp12-nodes` from `e2e/` (the full suite has known failures: mvp5, mvp6, mvp9-claude-cli, mvp9-connectors).
3. Pick the bump (0.x: `minor` for anything breaking or a new feature, `patch` for fixes). Ask the user if unclear.
4. In `packages/cli`: `npm version <patch|minor> --no-git-tag-version` bumps `package.json` only (in a workspace subfolder `npm version` does not commit or tag). Then from the repo root: `git add packages/cli/package.json && git commit -m "Release <version>" && git tag -a v<version> -m "Release <version>"` (annotated, or `--follow-tags` will not push it). If a hook refuses the commit, leave it and tell the user.
5. `git push origin main --follow-tags`.
6. The `Publish` workflow (`.github/workflows/publish.yml`) runs on the `v*` tag: check, test, build, `smoke:install`, then `npm publish --provenance --access public` in `packages/cli` through npm trusted publishing (OIDC, no token). It appears a few seconds after the push: `gh run list --workflow publish.yml --limit 1 --json databaseId,headBranch`, then `gh run watch <id> --exit-status`.
7. Verify: the publish step logs `+ @pablopunk/tau@<version>`, but the registry's `latest` tag lags by one to three minutes. Poll `https://registry.npmjs.org/-/package/@pablopunk/tau/dist-tags` until it flips before telling the user to update.

Never move or re-push a tag that CI already ran on. If a release fails, fix forward with a new patch version. `workflow_dispatch` re-runs the workflow without touching tags, but the version in `packages/cli/package.json` must be unpublished.

`smoke:install` packs the CLI, installs the tarball with npm into a temp dir, runs `tau --version` and `tau serve --faux --no-open` on a scratch home and random port, and checks `pi-env`, `@opentunnel/client` and `effect` resolve (they are `neverBundle`). It never touches `~/.tau`.

## Trusted publishing

Needs npm 11.5+ (the workflow upgrades it; Node 22 ships 10) and the trusted publisher configured on the package's npmjs.com access page (repo `pablopunk/tau`, workflow `publish.yml`, no environment). The first version must exist on npm before that can be configured (publish it by hand once). Provenance needs a public GitHub repo. Do not add an `NPM_TOKEN`.

Manual publish (only if CI is unavailable): the user runs `npm publish --access public` in `packages/cli` in a real terminal so npm can ask for the authenticator code, or passes `--otp=<code>`. The agent does not publish.

`.claude/` is gitignored and does not exist in the repo; there is no `.claude/skills` symlink to maintain. Skills live in `.agents/skills`.

## After a release

- Nodes linked to a hub must run the same tau version: a different `PROTOCOL_VERSION` shows as "Update tau on <node>". Remind the user to update every node: `npm i -g @pablopunk/tau@latest`, then `tau restart`.
- The web app is served by the installed server, so it changes only after that update and restart.
