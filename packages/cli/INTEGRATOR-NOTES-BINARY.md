# Integrator notes: CLI owner (bun binary)

- `run.ts` passes `cliCommand` and `assets: { versionDir }` to `createCore` through a local cast
  (`as Parameters<CreateCore>[0]`), plus `cliEntry` (= `cliCommand.args[0]`, only set in dev) for today's core. When
  core declares both options, drop the cast and the `cliEntry` line.
- New e2e hook `TAU_RELEASES_API` (honoured only for a home under the temp dir, like `TAU_FAKE_LATEST`): a base URL
  replacing `https://api.github.com/repos/pablopunk/tau`. It must serve `/releases/latest` and `/releases/tags/v<x>`
  as GitHub does (`tag_name`, `assets[].name` and `browser_download_url`; assets `tau-<v>-<os>-<arch>.tar.gz`
  with one folder holding `tau`, and `SHA256SUMS`). For `binary.spec.ts` / update e2e.
- Archive layout the updater expects: `tau-<v>-<os>-<arch>.tar.gz` (os `darwin|linux`, arch `arm64|x64`; linux-x64 is
  the baseline build), extracting to the version folder itself or to one sub-folder. Extraction runs `tar -xzf`.
- The updater child is the OLD binary (`versions/<old>/tau`); it runs `<root>/current/tau restart` after the swap.
- `<home>/server.json` `{ pid, versionDir }` is written by `serve.ts` only when compiled.
- `tau update` in the Node build or a dev checkout refuses (`install.mode: none`); e2e update tests need a compiled
  binary or an injected `TAU_FAKE_UPDATE` child (still honoured).
- Removed with the npm flow: `install-method`, `global-package`, `verify-install`, `bootstrap`, `entry-guard`,
  `mise-notice`, `node` lookup. `smoke-install/smoke-bare` scripts and e2e npm layouts are release/integrator work.
- Not done in my folders: `core` npm text, web copy (`UpdateButton`) must stop mentioning npm `LAG_NOTE` text is mine.
