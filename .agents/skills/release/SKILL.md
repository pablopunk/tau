---
name: release
description: Release a new version of tau (the `packages/cli` package) to npm. Use when the user says /release, "ship it", "publish", or asks to cut a version.
---

# Release tau

Publishing is outward-facing: confirm the package name and the version bump with the user before tagging or pushing.

## Not set up yet (do these once, with the user)

- The npm name `tau` is taken by someone else. Decide the name (for example `@pablopunk/tau`), set it in `packages/cli/package.json`, and add `"publishConfig": { "access": "public" }`. The `tau` binary name stays.
- The repo has no git remote. Create the GitHub repo and push `main`.
- Add `.github/workflows/publish.yml` (copy `~/src/webr/.github/workflows/publish.yml`: on `v*` tags run `pnpm install --frozen-lockfile`, check, test, build, a smoke test, `npm install --global npm@11`, then `npm publish --provenance --access public` in `packages/cli`).
- Add a `smoke:install` script: `pnpm pack` the CLI, install the tarball into an empty temp directory, and run `tau --version` and `tau serve --faux` on a scratch home and random port. It must prove `pi-env`, `@opentunnel/client` and `effect` resolve from `node_modules` (they are `neverBundle`).
- Configure the npm trusted publisher on the package's npmjs.com access page (repo, workflow `publish.yml`). Do not add an `NPM_TOKEN`.
- Replace the `0.0.0` version with a first real version.

## Steps

1. Start from a clean `main` that is up to date with `origin/main`: `git status --short` is empty, `git fetch && git status -sb`.
2. Verify locally, unpiped (`pnpm check | grep …` returns grep's exit code and lets a type error through): `mise exec -- pnpm check`, `mise exec -- pnpm test`, `mise exec -- pnpm build`, `mise exec -- pnpm smoke:install`. The e2e suite has known failures (mvp5, mvp6, mvp9-claude-cli, mvp9-connectors); run the terminal, mvp12-remote and mvp12-machines specs from `e2e/`.
3. Pick the bump (0.x: `minor` for anything breaking or a new feature, `patch` for fixes). Ask the user if unclear.
4. In `packages/cli`: `npm version <patch|minor> -m "Release %s"` bumps `package.json`, commits and creates the `v<version>` tag.
5. `git push origin main --follow-tags`.
6. The `Publish` workflow runs on the `v*` tag. Watch it: `gh run list --workflow publish.yml --limit 1 --json databaseId`, then `gh run watch <id> --exit-status`.
7. Verify: the publish step logs `+ <name>@<version>`, but the registry's `latest` tag lags by one to three minutes. Poll `https://registry.npmjs.org/-/package/<name>/dist-tags` until it flips before telling the user to update.

Never move or re-push a tag that CI already ran on. If a release fails, fix forward with a new patch version.

Manual publish (only if CI is unavailable): the user runs `npm publish --access public` in a real terminal so npm can ask for the authenticator code.

## After a release

- Machines linked to a hub must run the same tau version: a different `PROTOCOL_VERSION` shows as "Update tau on <machine>". Remind the user to update every machine (`npm i -g <name>@latest`, then `tau restart`).
- The web app is served by the installed server, so it changes only after that update and restart.
