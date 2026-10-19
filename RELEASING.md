# Releasing tau

tau publishes to npm as `@pablopunk/tau` (binary `tau`) from GitHub Actions with npm trusted publishing (OIDC). No secrets or `NPM_TOKEN` are needed. The repo currently has **no git remote**.

## One-time setup (you)

1. **Create the GitHub repo** `pablopunk/tau`. Make it **public**: `npm publish --provenance` only works from a public repo. If it must stay private, remove `--provenance` from `.github/workflows/publish.yml` (trusted publishing itself still works, just without provenance).
2. Connect and push:
   ```sh
   git remote add origin git@github.com:pablopunk/tau.git
   git push -u origin main
   ```
3. GitHub settings: Actions enabled (Settings, Actions, General, allow actions); default branch `main`. Branch protection is optional; if you add it, pushing the release commit and tag must still be allowed. No secrets to add.
4. **First publish, manually.** The trusted publisher is configured on the package's npmjs.com settings page, which exists only once the package does. So publish `0.1.0` once yourself, from a real terminal (npm asks for the authenticator code; no provenance for this one):
   ```sh
   mise exec -- pnpm install --frozen-lockfile && mise exec -- pnpm build   # repo root
   cd packages/cli && npm publish --access public
   ```
   Do not push a `v0.1.0` tag (the Publish workflow would fail: the version exists). CI releases start at `0.1.1` via `npm version patch`.
5. **Trusted publisher:** npmjs.com, package `@pablopunk/tau`, Settings, Trusted Publisher, GitHub Actions: owner `pablopunk`, repository `tau`, workflow filename `publish.yml`, environment empty.

## Every release

Use the `release` skill (`.agents/skills/release/SKILL.md`): clean `main`, check/test/build/smoke, `npm version` in `packages/cli`, `git push origin main --follow-tags`, watch the Publish workflow.
