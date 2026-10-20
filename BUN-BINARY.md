# tau as a signed Bun binary (no npm)

Status: draft for review. Evidence: the validation report of 2026-10-20 (agent 24021), quoted as **[V]**.

## 1. Goal and decisions

- tau ships as a `bun build --compile` executable per platform, from GitHub Releases. npm publishing stops (only the owner uses tau).
- Install and update never depend on npm, pnpm, bun, volta, mise or a system `node`.
- macOS binaries are signed with the owner's Developer ID and notarized in CI, the same way `~/src/nvm` and `~/src/spotifin` do it.
- Tests stay on Node (vitest, tsdown dev build). Only the shipped artifact runs on Bun. **[V]** found no Node-only core behaviour.
- Platforms: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. Windows is out of scope.

## 2. Layout on disk

```
~/.local/share/tau/
  versions/0.5.0/      tau, pi-env, web/, skills/, SHA256SUMS
  versions/0.4.9/      the previous version (kept for rollback; older ones deleted)
  current -> versions/0.5.0
~/.local/bin/tau -> ~/.local/share/tau/current/tau
~/.tau/                data home, unchanged
```

- The service (launchd plist, systemd unit) and the `<home>/bin/tau` shim point at `~/.local/share/tau/current/tau`. An update only swaps `current`, so the service definition does not change and `tau restart` takes the `kickstart -k` / `systemctl restart` path, not a reload.
- `TAU_INSTALL_DIR` overrides `~/.local/share/tau` (tests and e2e use a scratch dir).

## 3. Archive

`tau-<version>-<os>-<arch>.tar.gz` contains one folder: `tau` (the binary), `pi-env` (the daemon for that platform), `web/` (web dist), `skills/` (builtin skills). The release also has `SHA256SUMS` and `install.sh`.

- Build: `bun build --compile --target=bun-<os>-<arch> --define TAU_VERSION='"<v>"' dist/bin.js dist/watchdog.js --outfile tau`. The watchdog worker must be an extra entrypoint **[V]**. Size about 100–120 MB **[V]**.
- Files that cannot live inside the binary are sidecars next to it, as Pi does (`scripts/build-binaries.sh:133-173` in earendil-works/pi) **[V]**.

## 4. Code changes

One new module, `cli/src/runtime/install-paths.ts` (foundation), answers every path question:
- `compiled`: true when `import.meta.url` starts with `/$bunfs` (or `typeof Bun !== "undefined" && Bun.main` points into it).
- `binary`: `realpath(process.execPath)` when compiled.
- `installDir`: `dirname(binary)`; in a dev checkout, today's behaviour.
- `version`: the `TAU_VERSION` define when compiled; `package.json` in a dev checkout.

Every break **[V]** found, and its fix:

| Today | Break in the binary | Fix |
|---|---|---|
| `version.ts` reads `package.json` | `ENOENT /$bunfs/package.json` | `install-paths.version` |
| `cli-entry.ts:11-18`, `serve.ts:69`, `lifecycle/deps.ts:67`, `update/real-*.ts` use `realpath(argv[1])` | `ENOENT /$bunfs/root/tau` | An entry is `{ command, args }`: `{ binary, [] }` compiled, `{ node, [entry] }` in dev |
| `service/spec.ts`, `render.ts` write `node entry args` | `binary binary serve` | Render from `{ command, args }`; the command is `current/tau` |
| `core/cli-shim/write-shim.ts:9` writes `exec node entry "$@"` | `exec tau tau "$@"` | Same `{ command, args }` |
| `static-dir.ts`, `discover-skills.ts:81`, `commands/skill.ts` use `import.meta.url` | web UI and skills missing | `installDir/web`, `installDir/skills` |
| `terminal-daemon.ts:49,56` uses pi-env `localDaemon()` | `/$bunfs/bin/...`, terminals `available:false` | `new Connection({ command: [installDir + "/pi-env"] })`, shown to work **[V]** |
| `serve.ts:27` watchdog URL | works if the worker is an entrypoint **[V]** | keep; build passes both entries |

## 5. Claude CLI threads without npm

Today `core/src/claude-cli/sdk-install.ts` runs `npm install --prefix <home>/claude-sdk` at runtime **[V]**. Options, decided by pin P3:
- **A (preferred):** the binary installs it itself: `BUN_BE_BUN=1 <tau> add --cwd <home>/claude-sdk @anthropic-ai/claude-agent-sdk@<pinned>`. **[V]** only checked that `BUN_BE_BUN=1` runs Bun's CLI, not `add`.
- **B:** ship the SDK and its per-platform native package as a sidecar in the archive.

The rest of `sdk-install.ts` (a `file://` import of the installed SDK) works in a binary **[V]**.

## 6. Install, update, rollback

**`install.sh`** (`curl -fsSL https://github.com/pablopunk/tau/releases/latest/download/install.sh | sh`):
1. Detect os/arch; refuse anything else with a clear message.
2. Download the archive and `SHA256SUMS` into a temp dir; verify the hash; extract into `versions/<v>`.
3. On macOS run `xattr -dr com.apple.quarantine` on the folder (a no-op for curl; harmless).
4. Swap `current` atomically (`ln -sfn` to a temp link, then `mv -f`), link `~/.local/bin/tau`, warn if `~/.local/bin` is not on PATH.
5. Run `tau` (bare): it installs or repairs the service and prints the sign-in link.

**`tau update`** and the sidebar button (reuses the UPDATE-BUTTON job file, nonce, restart guard and detached/systemd-run spawn):
- Availability: `GET https://api.github.com/repos/pablopunk/tau/releases/latest`; a version counts only when its archive for this platform and `SHA256SUMS` are both assets. Replaces the npm registry check in `latest-version.ts`. Unauthenticated limit is 60 requests/h per IP, so the 15 min check is fine.
- Install step: download, verify, extract into `versions/<v>`, run `versions/<v>/tau --version` and require `<v>`, then swap `current`.
- Restart step: `tau restart` as today.
- Rollback: if the new server does not answer `/api/health` within 60 s, swap `current` back, restart, mark the job `failed` with the log tail.
- Keep the newest two versions; delete older ones after a successful update.
- `install.mode`: `run` for a binary install, `none` for a dev checkout. The npm/pnpm/bun/volta/npx/mise matrix is deleted.

## 7. CI: build, sign, notarize, release

New `.github/workflows/release.yml` on `v*` tags (replaces `publish.yml`). Signing copies `~/src/spotifin/.github/workflows/release.yml:48-62` and `~/src/spotifin/scripts/build-macos-release.sh` (same secrets as nvm and spotifin).

Jobs:
1. **check**: `pnpm check`, `pnpm test`, `pnpm build` (ubuntu).
2. **build-linux** (ubuntu): compile `linux-x64` and `linux-arm64`, add sidecars, upload artifacts.
3. **build-macos** (`macos-latest`): compile `darwin-arm64` and `darwin-x64`, then sign:
   - Keychain: decode `MACOS_CERT_P12_BASE64`, `security create-keychain` with a random password, `set-keychain-settings -lut 21600`, `unlock-keychain`, `import -P "$MACOS_CERT_PASSWORD" -A -t cert -f pkcs12`, `set-key-partition-list -S apple-tool:,apple:`, `list-keychains`, `default-keychain`.
   - Sign `pi-env` first, then `tau`: `codesign --force --options runtime --timestamp --sign "Developer ID Application: … ($APPLE_TEAM_ID)" --entitlements packaging/tau.entitlements`. Entitlements: `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory` (Bun's JIT needs them under the hardened runtime; pin P1). `pi-env` is Rust and needs none.
   - Verify like spotifin: `codesign --verify --strict`, `Authority=Developer ID Application`, `flags` contain `runtime`, no `get-task-allow`.
   - Notarize: `ditto -c -k` the two binaries, `xcrun notarytool submit --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait`. Bare executables cannot be stapled; Gatekeeper checks the ticket online on first run (pin P2).
4. **smoke** (matrix: ubuntu x64, ubuntu arm64, macos arm64): download the platform archive, run `install.sh` with `TAU_INSTALL_DIR` and `TAU_HOME` in temp dirs, `tau --version`, `tau serve --faux --no-open --port <random>`, `/api/health`, a faux thread, a terminal running `echo`. On macOS also `spctl --assess --type execute -vv tau`.
5. **release**: `SHA256SUMS`, `gh release create v<v>` with the four archives, `SHA256SUMS` and `install.sh`. Runs only after every smoke passes, so a tag never points at a broken release.

Secrets (the owner sets them; agents never see them): `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`. Add `scripts/setup-gh-secrets.sh` copied from `~/src/nvm/scripts/setup-gh-secrets.sh`. `gh secret list` on tau is empty today.

The version lives in `packages/cli/package.json` (`"private": true`, no `bin`/`files`/`publishConfig`), read at build time into `TAU_VERSION`.

## 8. Removing npm

From **[V]**: delete `publish.yml`, `scripts/smoke-install.ts`, `smoke-bare.ts` and their root scripts (replaced by `scripts/smoke-binary.ts`); `update/install-method.ts`, `global-package.ts`, the npm parts of `latest-version.ts`, `latest-source.ts`, `update-text.ts`; `service/entry-guard.ts` and `mise-notice.ts`; npm copy in web (`UpdateButton`, `node-text.ts`, `NodesSection`); README, `BARE-INSTALL.md`, the release skill. `npm unpublish` is not needed: npm keeps 0.4.x, the README stops pointing to it.

## 9. Migration of the two real nodes

Both run npm/bun installs of 0.3.0 or 0.4.0. Once per node, by hand:
`curl -fsSL …/install.sh | sh`, then `npm rm -g @pablopunk/tau` / `bun rm -g @pablopunk/tau`. Bare `tau` sees the service entry changed and repairs it (`needsRepair`). The data home stays. Linked nodes keep working: the link protocol does not change in this release.

## 10. Phase 0 pins (foundation runs these first, results go here)

- **P1** A Developer-ID-signed binary with the hardened runtime and the two entitlements runs `serve`, a thread and a terminal on macOS. Without them it crashes (expected). Run locally if `security find-identity -p codesigning -v` shows the owner's identity; otherwise first CI run.
- **P2** `notarytool` accepts the zipped bare binaries; a quarantined copy then passes `spctl` with no dialog.
- **P3** Claude SDK without npm: option A or B, with a real `claude-cli` faux-free check of import only (no login).
- **P4** Untested sidecars under the binary: photon wasm and image-resize worker, codemode worker and `quickjs.wasm`, pdfjs fonts, readability. Each either works or gets a sidecar, or is listed as unsupported.
- **P5** A terminal through the compiled server with the explicit pi-env path.
- **P6** The update swap while the service runs: old binary keeps running until restart; rollback restores the old `current`.
- **P7** `linux-arm64` and `linux-x64` binaries run on a Debian 13 VM or CI runner (vibemachine only with the owner's yes).

## 11. Work split (no file has two owners)

1. **Foundation:** `install-paths.ts`, `{ command, args }` entry type, `TAU_VERSION` define, `scripts/build-binary.ts` (local compile of one platform), protocol changes (`install.mode` values, update copy), pins P1–P7, hand-off section.
2. **Owner CLI** (`cli/src/service/**`, `cli/src/update/**`, `cli/src/lifecycle/**`, `cli-entry.ts`, `serve.ts`, `version.ts`): service and spec, updater for binaries, availability check against GitHub Releases, rollback, npm code removal in the CLI.
3. **Owner core** (`core/src/cli-shim/**`, `core/src/harness/terminal-daemon.ts`, `core/src/skills/**`, `core/src/claude-cli/sdk-install.ts`): shim, pi-env path, skills path, SDK install per P3.
4. **Owner release** (`.github/workflows/**`, `scripts/**`, `install.sh`, `packaging/**`): CI jobs, signing, notarization, smoke, `install.sh`, secrets script.
5. **Owner web** (`web/src/**`): update copy, manual command for a dev checkout, server static dir if it lives in web.
6. **Integrator:** README, release skill, `BARE-INSTALL.md`, e2e `binary.spec.ts` that runs the packaged binary from a scratch `TAU_INSTALL_DIR` (server, thread, terminal, update to a local fake release, rollback), the first real release from a tag.

## 12. Risks

- **Bun runtime gaps** found only at runtime (P4). Mitigation: e2e on the packaged binary, not on `node dist/bin.js`.
- **Claude SDK install** (P3) is the least validated piece.
- **Signing** needs the secrets in place before the first tag; until then CI builds unsigned macOS archives and the release job refuses to publish them.
- **100+ MB per platform** per release; GitHub Releases has no practical limit for this.
