---
name: release
description: Release a new version of tau (the `packages/cli` package) as signed binaries on GitHub Releases. Use when the user says /release, "ship it", "publish", or asks to cut a version.
---

# Release tau

tau ships as a `bun build --compile` binary per platform from GitHub Releases (design: `BUN-BINARY.md`). There is no npm publish. Releasing is outward-facing: confirm the version bump with the user before tagging or pushing.

## Steps

1. Start from a clean `main` that is up to date with `origin/main`: `git status --short` is empty, `git fetch && git status -sb`.
2. Verify locally, unpiped (a pipe returns the last command's exit code and lets a type error through): `mise exec -- pnpm check`, `mise exec -- pnpm test`, `mise exec -- pnpm build`, `mise exec -- pnpm smoke:binary`. Then run the e2e specs `update-button`, `binary`, `terminal`, `mvp12-remote` and `mvp12-nodes` from `e2e/`.
3. Pick the bump (0.x: minor for anything breaking or a new feature, patch for fixes). Ask the user if unclear.
4. Edit `version` in `packages/cli/package.json`, then from the repo root: `git add packages/cli/package.json && git commit -m "Release <version>" && git tag -a v<version> -m "Release <version>"` (annotated, or `--follow-tags` will not push it). If a hook refuses the commit, leave it and tell the user.
5. `git push origin main --follow-tags`.
6. The `Release` workflow (`.github/workflows/release.yml`) runs on the `v*` tag: check, test, build, compile every platform, sign and notarize macOS, smoke the archives, then publish the GitHub release. It appears a few seconds after the push: `gh run list --workflow release.yml --limit 1 --json databaseId,headBranch`, then `gh run watch <id> --exit-status`.
7. Verify the GitHub release: `gh release view v<version> --json assets,isDraft` lists `tau-<version>-<os>-<arch>.tar.gz` for darwin-arm64, darwin-x64, linux-x64 and linux-arm64, plus `SHA256SUMS` and `install.sh`, and `isDraft` is false. `curl -fsSL https://github.com/pablopunk/tau/releases/latest/download/SHA256SUMS` answers.

Never move or re-push a tag that CI already ran on. If a release fails, fix forward with a new patch version.

Secrets (signing certificate, notarization) live in the repo's GitHub secrets; never print or read them.

## After a release

- Nodes linked to a hub must run the same tau version: a different `PROTOCOL_VERSION` shows as "Update tau on <node>". Remind the user to run `tau update` on every node.
- The web app is served by the installed server, so it changes only after that update and restart.
