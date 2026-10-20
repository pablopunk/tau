# tau as a signed Bun binary (no npm)

Status: approved v3; Phase 0 and foundation done (sections "Phase 0 results" and "Foundation hand-off"), after review rounds 1 and 2 (agent 24302). Evidence: the validation report of 2026-10-20 (agent 24021), quoted as **[V]**; the review, quoted as **[R#n]**.

## 1. Goal and decisions

- tau ships as a `bun build --compile` executable per platform, from GitHub Releases. npm publishing stops (only the owner uses tau). npm keeps 0.4.x; nothing is unpublished.
- Install and update never depend on npm, pnpm, bun, volta, mise or a system `node`.
- macOS binaries are signed with the owner's Developer ID and notarized in CI, as `~/src/nvm` and `~/src/spotifin` do. Unsigned or ad-hoc macOS archives are CI-only and never installed on the owner's nodes: an ad-hoc cdhash changes every release, so TCC prompts return **[R#14]**.
- Tests stay on Node (vitest, tsdown dev build). Only the shipped artifact runs on Bun. **[V]** found no Node-only core behaviour.
- Platforms: `darwin-arm64`, `darwin-x64`, `linux-x64` (`bun-linux-x64-baseline`, for old VPS CPUs), `linux-arm64`. Windows is out of scope.
- Bun is pinned in CI and locally (`.bun-version`, ≥ 1.2.4 for codesign support **[R#13]**).
- `UPDATE-BUTTON.md` is superseded where it lists npm/pnpm install methods; add a one-line note at its top.

## 2. Layout on disk and the two paths

```
~/.local/share/tau/            install root (TAU_INSTALL_DIR overrides)
  versions/0.5.0/              tau, pi-env, claude-sdk/, web/, skills/
  versions/0.4.9/              the previous `current`, kept for rollback
  current -> versions/0.5.0
~/.local/bin/tau -> ~/.local/share/tau/current/tau
~/.tau/                        data home, unchanged
```

`cli/src/runtime/install-paths.ts` (foundation) gives **two different paths** **[R#1]**:
- `stableBinary` = `<installRoot>/current/tau`. Used by the service spec, `needsRepair`, the `<home>/bin/tau` shim and `~/.local/bin/tau`. `installRoot` is derived by stripping `/versions/<v>/tau` from `realpath(process.execPath)`; if the realpath is not under a `versions/` dir (a hand-placed binary), `stableBinary` is the realpath itself.
- `versionDir` = `dirname(realpath(process.execPath))`. Web assets, skills, `pi-env` and the Claude SDK load from it, so a running old server never reads the new `web/` between the swap and the restart.
- `compiled`: `import.meta.url` (a `file://` URL) includes `/$bunfs/`, or `Bun.main` does [R2-N6]; P8 confirms which. In a dev checkout both paths fall back to today's `{ node, entry }`.
- `version`: the `TAU_VERSION` build define when compiled, `package.json` in dev.

`TAU_INSTALL_DIR` is read only by `install.sh` and tests; the binary derives its root from its own realpath [R2-N7]. `service.json` today records `{ node, entry }` (`manager.ts:53,76`); an old record read by the new code counts as a mismatch and triggers one repair (tested) [R2-N7].

Test: after a `current` swap, `buildSpec` and the rendered plist/unit are byte-identical, so `restart` takes `kickstart -k` / `systemctl restart`, never a reload. Pin P8 checks what `process.execPath` returns when the binary is started through `~/.local/bin/tau` and through `current/tau`.

## 3. Archive

`tau-<version>-<os>-<arch>.tar.gz`, one folder: `tau`, `pi-env`, `claude-sdk/` (section 5), `web/`, `skills/`. The release also has `SHA256SUMS` and `install.sh`.

- Build: `bun build --compile --target=bun-<os>-<arch> --define TAU_VERSION='"<v>"' dist/bin.js dist/watchdog.js --outfile tau`. The watchdog worker is an extra entrypoint **[V]**. About 100–120 MB **[V]**.
- `pi-env` comes from the pnpm-installed `@earendil-works/pi-env/bin/pi-env-<os>-<arch>/pi-env` (prebuilt in the package; extracted in CI) **[R#12]**.
- Sidecars next to the binary, as Pi does (`scripts/build-binaries.sh:133-173` in earendil-works/pi) **[V]**. Any further sidecar comes from pin P4's table.
- The tarball contains the **signed** binaries; `SHA256SUMS` is computed after tarring. The notarization zip is a separate, throwaway artifact **[R#13]**.

## 4. Code changes

Every `node` + JS-entry assumption, with its fix. An entry becomes `{ command, args }`: `{ stableBinary, [] }` compiled, `{ node, [entry] }` in dev.

| Place | Break in the binary | Fix | Owner |
|---|---|---|---|
| `version.ts` reads `package.json` | `ENOENT /$bunfs/package.json` **[V]** | `install-paths.version` | foundation |
| `cli-entry.ts:11-18` `realpath(argv[1])` | `ENOENT /$bunfs/root/tau` **[V]** | returns `{ command, args }` | foundation (first edit) |
| `serve.ts:69`, `lifecycle/deps.ts:67`, `lifecycle/bootstrap.ts` (`boot.entry`, `execPath`), `update/real-updater.ts:10`, `update/real-deps.ts:37`, `update/updater.ts:37` | same | use `cli-entry` | CLI |
| `service/spec.ts`, `render.ts:7,38,94`, `manager.ts:53,76,102,104` (`needsRepair`) | `binary binary serve` | render and compare `{ command, args }`; `command` = `stableBinary` | CLI |
| `core/cli-shim/write-shim.ts:9`, `core/create-core.ts:135` | `exec tau tau "$@"` **[V]** | shim from `{ command, args }` | core |
| `static-dir.ts:5`, `discover-skills.ts:81`, `commands/skill.ts:5` | web UI and skills missing | `versionDir/web`, `versionDir/skills` | core / CLI per folder |
| `terminal-daemon.ts:49,56` pi-env `localDaemon()` | `/$bunfs/bin/...`, terminals `available:false` **[V]** | `new Connection({ command: [versionDir + "/pi-env"] })` **[V]** | core |
| `claude-cli/sdk-port.ts:264,272` `createRequire(import.meta.url).resolve` | dev fallback unverified in `/$bunfs` **[R#7]** | resolve from `versionDir/claude-sdk` when compiled | core |
| `claude-cli/sdk-install.ts:27` `execFile("npm")`, consumer `createNpmSdkInstaller` in `create-core.ts` **[R#15]** | npm missing | removed: the SDK ships in the archive (section 5) | core |
| `serve.ts:27` watchdog URL, `start-watchdog.ts:30` | works if the worker is an entrypoint **[V]** | keep; build passes both entries | — |
| `update/real-updater.ts:10`, `update/real-deps.ts:37`, `lifecycle/deps.ts:67` `realpathSync(process.argv[1])` | **Measured:** the compiled `tau serve` dies at start with `ENOENT: lstat '/$bunfs/root/tau'` (P0 run) | take paths from `cli-entry`/`install-paths`; no `argv[1]` realpath when compiled | CLI |
| `update/latest-source.ts:15`, `update/real-deps.ts:42` `fetchLatestVersion(spawn, process.execPath)` | npm query through `execPath` | replaced by the GitHub release check (section 6) | CLI |
| `lifecycle/bootstrap.ts:18,111,145` `execPath`, `isBun` | bare tau hands off to a global package | removed (section 8) | CLI |
| `claude-cli/sdk-port.ts:264` `createRequire(join(sdkHome, "package.json")).resolve(SDK)` | **Measured:** `Cannot find module` in a compiled binary, with or without a `package.json` (a `bun script` run resolves it) | import `join(versionDir, "claude-sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs")` as a `file://` URL: **measured to work** | core |
| `provider/provider-service.ts:88` `sdkHomeOf(dirname(credentialsFile))` | SDK looked up in `<home>/claude-sdk` | `versionDir/claude-sdk` when compiled | core |
| `core/create-core.ts:135` `writeTauShim(home.root, process.execPath, options.cliEntry)` | compiled `execPath` = `current/version/tau`, not stable | option `cliCommand` (below), shim from `{ command, args }` | core |
| `skills/discover-skills.ts:81` `import.meta.url` + `BUILTIN_SKILL_LOCATIONS` | `/$bunfs/root/...` | add `versionDir/skills/tau/SKILL.md` | core |
| `static-dir.ts:5` / `commands/skill.ts:5` `import.meta.url` | same | `versionDir/web` (has `index.html`), `versionDir/skills/tau/SKILL.md` | CLI |
| `serve.ts:27` `new URL("./watchdog.js", import.meta.url)` | none: **measured** `serve --service` runs in a compiled binary with `watchdog.js` as the second entrypoint, no worker error in `logs/server.log` | keep | - |
| `core/testing/record-fixtures.ts:9`, `claude-cli/pins/scenario-tool-search-write.ts:19`, `test-support/fake-gh.ts:32` | dev and test tools only, never in the shipped bundle | none | - |
| deps: `pi-durable/dist/images/node.js:38,60`, `node-worker.js:9` (Photon wasm + worker), `pi-codemode/dist/wasm.js:10`, `runtime/host.js:6` (QuickJS wasm + worker) | default paths do not resolve in a compiled binary (P4) | **not called by tau** (no `createNodePhotonImages` or codemode use in `packages/*/src`); if ever enabled, pass explicit paths (P4) | - |

The foundation ran `grep -rn "argv\[1\]\|import.meta.url\|process.execPath\|createRequire\|__dirname" packages/*/src --include=*.ts` (tests excluded) and added every further hit to the table above (done, with the measured results).

## 5. Claude CLI threads without npm (decided: ship the SDK)

**Decision [R#9]:** the archive contains `claude-sdk/`: `@anthropic-ai/claude-agent-sdk` at the version pinned in the lockfile, plus its per-platform native package for the archive's platform, installed in CI with `pnpm deploy`/`npm pack` into the folder. No network or package manager at runtime; offline install works.

- **Prune first [R2-N2]:** in CI, delete every vendored file not for the archive's os/arch (e.g. `vendor/ripgrep/<other platforms>`, foreign `.node` files, Linux ELF files in a macOS archive). Record the pruned size in P3.
- **Find and sign every Mach-O [R2-N2]:** `find claude-sdk -type f -exec file {} +`, keep `Mach-O` hits, sign each. The job fails if any Mach-O is left unsigned (`codesign --verify` on each) before notarization.
- **Entitlements for Bun-based natives [R2-N1]:** the Claude Code native CLI is (unverified) a Bun single-file executable, so it gets the same `packaging/tau.entitlements` as `tau`. Every other Mach-O (ripgrep, `.node`) is signed without entitlements. Re-signing replaces Anthropic's signature; that is expected and recorded here.
- Signing order: SDK Mach-Os, `pi-env`, then `tau` (inside-out, as spotifin `build-macos-release.sh:30-46`). All of them go in the notarization zip.
- `sdk-port.ts` imports the SDK from `versionDir/claude-sdk` with a `file://` URL (shown to work in a binary **[V]**).
- Pin P3 checks, on a **hardened-runtime, Developer-ID-signed** copy of `tau` and the SDK (not an unsigned one) [R2-N1]: the compiled server finds the SDK, starts the native Claude CLI as a child without a crash, and a no-login call reaches it. No real login.
- Cost: archive size grows by the SDK native (measured in P3).

## 6. Install, update, rollback

**`install.sh`** (`curl -fsSL https://github.com/pablopunk/tau/releases/latest/download/install.sh | sh`), non-interactive, safe when piped **[R#16]**:
1. Refuse to run as root. Detect os/arch; refuse anything else with a clear message.
2. Download the archive and `SHA256SUMS` into a temp dir; verify; extract into `versions/<v>`.
3. macOS: `xattr -dr com.apple.quarantine` on the folder (a no-op for curl).
4. Swap `current` with `rename()` semantics: Linux `ln -s versions/<v> current.tmp && mv -T current.tmp current`; macOS `mv -fh` **[R#10]**. Link `~/.local/bin/tau`.
5. List every other `tau` on PATH (`which -a tau`) that is not `~/.local/bin/tau` and print how to remove it; warn if `~/.local/bin` is not on PATH **[R#5]**.
6. Run bare tau **by absolute path** (`<installRoot>/current/tau`): it installs or repairs the service, rewrites the shim and prints the sign-in link.

**`tau update`** and the sidebar button reuse the UPDATE-BUTTON job file, nonce, restart guard and detached/systemd-run spawn. The node implementation of the swap calls `rename()` directly.
- Availability: `GET https://api.github.com/repos/pablopunk/tau/releases/latest` with a `User-Agent`. A version counts only when its archive for this platform and `SHA256SUMS` are both assets. 403/429: honour `retry-after` and keep the previous `latest` (`update-service.ts:51`). Tests: 404, 403 with `retry-after`, partial assets, timeout, TLS/proxy error; each leaves a good `latest` intact **[R#11]**. The repo is public, so no auth; 4 checks/h per node is under the 60/h-per-IP limit.
- Install step (the child): download, verify, extract into `versions/<v>`, run `versions/<v>/tau --version` and require `<v>`, swap `current`.
- Restart step: `tau restart` as today.
- **Rollback is done by the child** **[R#10]**: if `GET /api/update` does not report `current === target` within `ROLLBACK_TIMEOUT_MS` (a named constant, 60 s to start; P6 measures a signed first run on a slow host) (`/api/health` cannot tell the old server from the new one [R2-N4]), the child swaps `current` back to the previous dir, restarts, and writes the job `failed` with the log tail and `from` = the old version (so the "`current !== from` → idle" rule does not fire; tested).
- Retention: keep the new `current` and the dir that was `current` before the swap (not semver order). Never delete the dir the running server started from: the server writes `{ pid, versionDir }` into a new `<home>/server.json` at start on every backend (written from `serve.ts`), and retention reads it. `service.pid` keeps its bare-pid format (`detached.ts:60,71,134`) [R2-N5, R3]. Delete others only after a successful update.
- `install.mode`: `run` for a binary install, `none` for a dev checkout.
- The `TAU_FAKE_LATEST`, `TAU_FAKE_UPDATE` and `TAU_FAKE_VERSION` hooks stay (same under-tmpdir rule) and are rewired to the release source **[R#6]**.

## 7. CI: build, sign, notarize, release

New `.github/workflows/release.yml` on `v*` tags (replaces `publish.yml`), with `permissions: contents: write` for the draft release [R2-N7]. Keychain setup copies `~/src/spotifin/.github/workflows/release.yml:48-62`; secrets are those of `~/src/nvm/scripts/setup-gh-secrets.sh:8-10,36-40`.

Jobs:
1. **check** (ubuntu): `pnpm check`, `pnpm test`, `pnpm build`; fail unless the tag equals `packages/cli/package.json` `version` **[R#19]**.
2. **build-linux** (ubuntu): compile `linux-x64-baseline` and `linux-arm64`, add sidecars (pi-env, claude-sdk for that platform), upload.
3. **build-macos** (`macos-latest`, arm64): compile `darwin-arm64` and `darwin-x64`, add sidecars, then sign:
   - Keychain: decode `MACOS_CERT_P12_BASE64`, `security create-keychain` (random password), `set-keychain-settings -lut 21600`, `unlock-keychain`, `import -P "$MACOS_CERT_PASSWORD" -A -t cert -f pkcs12`, `set-key-partition-list -S apple-tool:,apple:`, `list-keychains`, `default-keychain`.
   - Sign inside-out (SDK natives, `pi-env`, `tau`): `codesign --force --options runtime --timestamp --sign "Developer ID Application: … ($APPLE_TEAM_ID)"`. `tau` also gets `--entitlements packaging/tau.entitlements` with **Bun's full list** **[R#2]** (bun.com/docs/bundler/executables, "Code signing on macOS"): `allow-jit`, `allow-unsigned-executable-memory`, `disable-executable-page-protection`, `allow-dyld-environment-variables`. Prune only after P1 proves a smaller set.
   - Verify: `codesign --verify --strict -vv`, `Authority=Developer ID Application`, `flags` contain `runtime`, no `get-task-allow`. **No `spctl --assess --type execute`** on a bare Mach-O (it reports "not an app") **[R#3]**.
   - Notarize: `ditto -c -k` the signed Mach-Os, `xcrun notarytool submit --apple-id --password --team-id --wait`. Bare executables cannot be stapled; the ticket is checked online on first run, so an offline first run of a browser-downloaded copy has no trust (curl installs are not quarantined, so they are unaffected).
4. **smoke** (matrix): `ubuntu-latest` (linux-x64), `ubuntu-24.04-arm` (linux-arm64; confirm the label in GitHub docs before writing the job, else qemu) **[R#12]**, `macos-latest` (darwin-arm64). Run `install.sh` with `TAU_INSTALL_DIR` and `TAU_HOME` in temp dirs, `tau --version`, `tau serve --faux --no-open --port <random>`, `/api/health`, a faux thread, a terminal running `echo`, the Claude SDK import check. **darwin-x64 ships un-smoked** (no x64 macOS runner); try it under Rosetta on `macos-latest` if available, otherwise say so in the release notes.
5. **release**: create the release as a **draft**, upload the four archives, `SHA256SUMS` and `install.sh`, then publish it **[R#11]**. Runs only after every smoke passes.

Secrets (the owner sets them; agents never see them): `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`. `scripts/setup-gh-secrets.sh` copies nvm's (it takes `MACOS_CERT_P12_PATH` and base64-encodes it). Until the secrets exist the macOS job fails and nothing is released.

The version lives in `packages/cli/package.json` (`"private": true`, no `bin`/`files`/`publishConfig`/`engines`), read at build time into `TAU_VERSION`.

## 8. Removing npm

Delete or rewrite, each in the same step as its replacement so `check`, CI and e2e stay green **[R#6]**:
- **CI and scripts:** `publish.yml`; `scripts/smoke-install.ts`, `smoke-bare.ts`, root `package.json:15-16` scripts; the `pnpm smoke:install` line in `.github/workflows/ci.yml` becomes `pnpm smoke:binary` (`scripts/smoke-binary.ts`: compile for the host, run the smoke steps of section 7).
- **CLI update:** `install-method.ts`, `global-package.ts`, npm parts of `latest-version.ts` (`npmOf`, `PACKAGE_NAME`, line 12), `latest-source.ts` (its fake hooks move, see 6), `update-text.ts` (`NPM_I`), the npm matrix in `updater.ts` and `run-update.ts`, and their tests.
- **CLI lifecycle:** the "bare tau hands off to the global package" flow in `lifecycle/bootstrap.ts:104-152` (`entryOfPackage`, `packageDir`, `isBun`, `nodeOnPath`) and `restart-step.ts`; the `node`/`node.exe` lookup in `lifecycle/deps.ts:82`.
- **CLI service:** `service/entry-guard.ts` and `mise-notice.ts`, plus their uses in `detached.ts:6,128,142` and `manager.ts:7,107,140`.
- **Core:** `sdk-install.ts` (npm), `createNpmSdkInstaller` wiring in `create-core.ts`, npm text in `core/src/provider/provider-service.ts`.
- **Web:** npm copy in `UpdateButton`, `update-copy.ts`, `web/src/nodes/node-text.ts`, `NodesSection`.
- **CI e2e job:** `ci.yml` downloads `cli-dist` (`packages/cli/dist`) for e2e. Decision [R2-N6]: e2e keeps running on the Node build (`packages/cli/dist`); only `binary.spec.ts` and `smoke:binary` run the compiled binary, built in the same job.
- **e2e:** `e2e/update-support.ts` and `tests/update-button.spec.ts` build npm-global and `_npx` layouts; rewrite them for a scratch `TAU_INSTALL_DIR` with two fake local releases.
- **Docs and skills:** README (npx, `npm i -g`), `BARE-INSTALL.md`, the release skill (`.agents/skills/release`), the builtin `tau` skill (`core/src/skills/builtin/tau/SKILL.md`), the superseded note in `UPDATE-BUTTON.md`.

## 9. Migration of the two real nodes

The first binary release has a **different protocol version** from 0.3.0/0.4.0 (routes changed since 0.3.0). A mismatched peer is `update-required` and its summaries stop (`create-nodes.ts:346`) **[R#4]**. So migrate **both nodes in one sitting**, vibemachine first (it does not stop this thread), then the Mac.

Per node:
1. `curl -fsSL …/install.sh | sh` (runs the new binary by absolute path, step 6).
2. Remove the old package: Mac `bun rm -g @pablopunk/tau`, delete the broken mise `tau` shim; vibemachine `npm rm -g @pablopunk/tau`.
3. Check list: `which -a tau` shows only `~/.local/bin/tau`; `tau status` says `running (service)`, `installed: yes`, the new version; `<home>/bin/tau` execs `current/tau`; the plist/unit points at `current/tau`; `tau nodes list` shows the other node `online` (after both are done).

The data home is untouched. If step 1 fails on a node, the old install still runs; nothing is removed until the check list passes.

## 10. Phase 0 pins (foundation runs these first; results go here)

- **P1** Locally, if `security find-identity -p codesigning -v` shows the owner's Developer ID: sign a compiled tau with the hardened runtime and the four entitlements; it runs `serve`, a faux thread and a terminal. Then try the two-entitlement set and record the result. Must pass before `release.yml` is written **[R#2]**. If no local identity, the owner runs the script once.
- **P2** Pass criterion: a quarantined (`xattr -w com.apple.quarantine …`), notarized copy runs on a Mac with no dialog. `spctl` is not the criterion **[R#3]**.
- **P3** On a hardened-runtime, Developer-ID-signed copy (section 5), the Claude SDK from `versionDir/claude-sdk` loads in the compiled server and starts its native CLI (no login). Record the size.
- **P4** Table of every runtime-loaded file (path in source, bundled or sidecar, tested): photon wasm and image-resize worker, codemode worker and `quickjs.wasm`, pdfjs fonts and cmaps, readability, glimpse. Each works, becomes a sidecar, or is listed unsupported. Owners get it in the hand-off **[R#8]**.
- **P5** A terminal through the compiled server with the explicit pi-env path.
- **P6** Swap while the service runs, on launchd and systemd (scratch label and home): the old binary keeps running until restart; `restart` uses `kickstart -k` (no reload); rollback restores the old `current`.
- **P7** `linux-x64-baseline` and `linux-arm64` binaries run on a Debian 13 VM or CI runner (vibemachine only with the owner's yes).
- **P8** `process.execPath` of a compiled binary started through a symlink: the symlink or its target? `install-paths` must derive both paths correctly either way.

## 11. Work split (no file has two owners)

1. **Foundation:** a `smoke:binary` stub script in root `package.json` (the release owner fills `scripts/smoke-binary.ts`) [R2-N3], `cli/src/runtime/install-paths.ts`, `cli-entry.ts` (`{ command, args }`), `version.ts`, `TAU_VERSION` define, `scripts/build-binary.ts`, `.bun-version`, `packages/cli/package.json`, `packages/cli/tsdown.config.ts`, root `package.json` scripts, protocol changes (`install.mode` values, update copy), pins P1–P8 with results, the completed section 4 grep, the P4 table, hand-off section.
2. **Owner CLI** (`cli/src/service/**`, `cli/src/update/**`, `cli/src/lifecycle/**`, `cli/src/serve.ts`, `cli/src/run.ts`, `cli/src/static-dir.ts`, `cli/src/commands/skill.ts`) [R2-N3]: spec and `needsRepair` on `{ command, args }`, updater for binaries, release availability check, swap, rollback, retention, fake hooks rewired, npm removal in the CLI.
3. **Owner core** (`core/src/cli-shim/**`, `core/src/create-core.ts`, `core/src/harness/terminal-daemon.ts`, `core/src/skills/**` **except** `core/src/skills/builtin/tau/SKILL.md`, `core/src/claude-cli/sdk-install.ts`, `sdk-port.ts`, `core/src/provider/provider-service.ts`) [R2-N3]: shim, pi-env path, skills path, SDK from `versionDir`.
4. **Owner release** (`.github/workflows/**`, `scripts/**` except `build-binary.ts`, `install.sh`, `packaging/**`): release workflow, signing, notarization, smoke, `smoke:binary`, the `ci.yml` line, `install.sh`, secrets script.
5. **Owner web** (`web/src/**`): update copy without npm.
6. **Integrator:** README, release skill, builtin tau skill (`core/src/skills/builtin/tau/SKILL.md`, carved out of core) [R2-N3], `BARE-INSTALL.md`, `UPDATE-BUTTON.md` note, e2e rewrite (`update-support.ts`, `update-button.spec.ts`) and a new `binary.spec.ts` that runs the packaged binary from a scratch `TAU_INSTALL_DIR` and a hashed scratch home (`names.ts:19-24`, so labels never clash **[R#17]**): server, thread, terminal, update to a local fake release, rollback. Then the first real release, then migration (section 9) with the owner.

## 12. Risks

- **Bun runtime gaps** found only at runtime (P4). Mitigation: `binary.spec` and `smoke:binary` on the packaged binary (other e2e stays on the Node build).
- **Signing**: entitlements (P1) and the SDK natives inside notarization (P3). Secrets must exist before the first tag.
- **darwin-x64** ships without a smoke run unless Rosetta works.
- **100+ MB per platform** per release; fine for GitHub Releases.

## Phase 0 results

Run on 2026-10-20 by the foundation agent: macOS 26 (Darwin 27.0.0) arm64, Bun 1.4.2, binaries compiled from this branch into a `mktemp -d` scratch dir (`bun build --compile --define TAU_VERSION=... dist/bin.js dist/watchdog.js`). Driver: `serve --faux --no-open` on a scratch `--home` and a random port; `providers set-key openrouter …`, `settings set-default-model faux/faux-1`, `projects add`, `threads start`, then `POST /api/conversations/:id/terminals` and a WebSocket that types `echo $((6*7))marker` and reads `42marker`. To run the pins on macOS the foundation applied **temporary local patches that are not committed** (the owners' real fixes, see hand-off): a guard for `realpathSync(process.argv[1])` in three files, `P5_PI_ENV` as the pi-env path in `terminal-daemon.ts`, and a direct `sdk.mjs` import in `sdk-port.ts`. Totals: `tau` 99.8 MB (darwin-arm64), 118.6 MB (linux).

| Pin | Result |
|---|---|
| P1 signing | **PASS** (four entitlements; two and even zero also ran, see below) |
| P2 notarization | **first CI run**, steps below |
| P3 Claude SDK sidecar | **PASS** with one required code change (no `createRequire.resolve`) |
| P4 runtime files | table below: nothing blocks; two code paths need the explicit-path change |
| P5 terminal | **PASS** |
| P6 swap while running | **PASS on launchd**; systemd = **first CI run** |
| P7 linux binaries | **PASS** on Debian 13 in Docker (arm64 native, x64-baseline emulated) |
| P8 execPath / import.meta | **PASS**, answer below |

### P1: signing (PASS)

Identity `Developer ID Application: Pablo Varela (2TZ4Q825M7)` (SHA-1 `C8DCCA7E5D1F872F238B3A9A753EA902D1D7444A`, listed by `security find-identity -p codesigning -v`). No keychain dialog appeared.

```
codesign --force --options runtime --timestamp --sign C8DCCA7E… --entitlements four.plist tau
codesign -dvv tau  ->  flags=0x10000(runtime)  Authority=Developer ID Application: Pablo Varela (2TZ4Q825M7)  Timestamp=20 Oct 2026
codesign --verify --strict -vv tau  ->  valid on disk / satisfies its Designated Requirement
```

`four.plist` = `com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`, `disable-executable-page-protection`, `allow-dyld-environment-variables`, each `<true/>` (standard `<plist><dict>` file; release owner puts it in `packaging/tau.entitlements`).

| Signed with | health | faux thread | terminal (`42marker`) | `serve --service` |
|---|---|---|---|---|
| four entitlements | `{"ok":true}` | ok | **TERMINAL_OK** | ok |
| two (`allow-jit`, `allow-unsigned-executable-memory`) | ok | ok | **TERMINAL_OK** | not run |
| none (hardened runtime only) | ok | ok | **TERMINAL_OK** | not run; a 5e7-iteration JIT loop also ran |

Decision: **ship the four** until a CI smoke on an older macOS runner shows the smaller set is safe. That zero entitlements ran here may only mean this macOS is lenient; Bun's docs require them. The plan's "prune only after P1 proves a smaller set" is met for two on this host, not for older hosts.

### P2: notarization (first CI run)

Not run: no Apple credentials here and no quarantined launch (it pops a GUI dialog). Exact CI steps, after signing inside-out:

```
ditto -c -k --keepParent <version-dir> notarize.zip      # signed tau, pi-env, claude-sdk Mach-Os
xcrun notarytool submit notarize.zip --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun notarytool log <submission-id>                     # on "Invalid", attach the log to the job
# criterion (once, on a macOS runner, after a curl download that is then quarantined):
xattr -w com.apple.quarantine "0081;$(printf %x $(date +%s));curl;" ./tau
./tau --version                                          # must print the version with no dialog
```

Stapling bare executables is not possible. `spctl` is not used.

### P3: Claude Agent SDK sidecar (PASS)

- `claude-sdk/node_modules/` = the pinned SDK (0.3.302) and its siblings (`@anthropic-ai/sdk`, `@modelcontextprotocol`, `zod`) copied with `cp -RL` from pnpm's virtual store, plus `@anthropic-ai/claude-agent-sdk-darwin-arm64`. Built by `scripts/build-binary.ts`. Pruned to darwin-arm64: **288 MB on disk, 122,435,571 bytes as `tar.gz`**. The native `claude` is 256 MB of that (JS and deps ~32 MB).
- **The native CLI is a Bun executable**: `file`: Mach-O 64-bit arm64; `strings` finds 13,004 Bun markers. It already carries Anthropic's Developer ID signature (`Q6L2SF6YDW`, `flags=0x10000(runtime)`) with `allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`, `apple-events`, `audio-input`. Re-signing with `tau.entitlements` replaces that (section 5); keeping Anthropic's signature in the notarization zip also qualifies. Release owner decides, `tau.entitlements` as planned.
- **Mach-O files in `claude-sdk/`: exactly one** (`…/claude-agent-sdk-darwin-arm64/claude`). No ripgrep, no `.node`, no `.dylib`. The CI "find and sign every Mach-O" step still runs, and must fail on zero hits so a layout change is noticed.
- **Finding:** `createRequire(join(sdkHome, "package.json")).resolve("@anthropic-ai/claude-agent-sdk")` **fails in a compiled binary** (`Cannot find module`, also with a real `package.json`, also through a symlinked folder); the same line under a plain `bun t.ts` and under Node works. `Bun.resolveSync` fails too. **A direct `import(pathToFileURL(".../node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs"))` works**, and the SDK then finds its sibling native package.
- With that one change (temporary patch), on the P1-signed binary: `tau providers "claude-cli refresh"` went from `state: sdk_missing` to `state: logged_out`, `sdkCliVersion: 2.1.302`. A separate signed probe binary imported the SDK from the sidecar and `await query.initializationResult()` returned (commands, agents, models) with the Anthropic-signed native `claude` running as a child (`pgrep` count 1), `HOME` and `CLAUDE_CONFIG_DIR` on a scratch dir, no login.
- Caveat for the core owner: `authStatus` (`sdk-port.ts:246`) runs the `claude` on `PATH` (it reported `cliVersion 2.1.304`, the owner's own install), not the sidecar's. On a node with no `claude` installed the state must still be sensible; test it, or point it at the sidecar's native binary.

### P4: runtime-loaded files

Source search: the grep of section 4 plus a search of `import.meta`, `__dirname`, `new Worker`, `.wasm`, `createRequire` in the Pi packages and `pi-web-access`. "Tested" = a compiled probe binary (`/tmp`-scratch) that imports the real package files.

| File or feature | Source path | Bundled or sidecar | Tested in a compiled binary |
|---|---|---|---|
| SQLite storage | `pi-durable/storage/sqlite/node` (`node:sqlite`) | built into Bun 1.4.2 | **works** (every server run above) |
| Watchdog worker | `cli/src/serve.ts:27` | second entrypoint `watchdog.js` | **works** (`serve --service`, no error) |
| Web UI | `cli/src/static-dir.ts:5` | sidecar `web/` | not served yet: the path code is the CLI owner's (hand-off) |
| Builtin skill | `core/src/skills/discover-skills.ts:81`, `cli/src/commands/skill.ts:5` | sidecar `skills/tau/SKILL.md` | owners (hand-off) |
| pi-env daemon | `pi-env/bin/pi-env-<os>-<arch>/pi-env` | sidecar `pi-env` | **works** with an explicit path (P5) |
| Claude SDK + native CLI | `claude-sdk/` | sidecar | **works** with a direct file import (P3); `createRequire.resolve` **fails** |
| Photon wasm + image worker | `pi-durable/dist/images/node.js:38,60`, `node-worker.js:9`; wasm `@silvia-odwyer/photon/photon_rs_bg.wasm` | none today | default `resolve` **fails** (`Cannot find module … photon_rs_bg.wasm`). Not called by tau (no `createNodePhotonImages` in `packages/*/src`). If used later: sidecar the wasm and call `createPhotonImages(readFile(path))`, as the Pi docs say |
| Codemode worker + `quickjs.wasm` | `pi-codemode/dist/runtime/host.js:6`, `wasm.js:10`; `quickjs-wasi/quickjs.wasm` | none today | default `resolve` **fails**; `loadQuickJSWasm(explicitPath)` **works**; `InlineCodemodeSandbox` loads. Not called by tau. If used: sidecar `quickjs.wasm` and pass the path and the worker URL as an entrypoint |
| pdfjs fonts and cmaps | `unpdf` (`pi-web-access`) | bundled | **works**: `getDocumentProxy` + `extractText` on a Helvetica PDF returned the text. `standardFontDataUrl`/`cMapUrl` only matter for PDFs with non-embedded fonts or CJK; untested |
| Readability | `@mozilla/readability` + `linkedom` (`pi-web-access`) | bundled | **works** (article parsed, 1002 chars) |
| Glimpse | `pi-web-access/dist/index.js:25127` `require.resolve("glimpseui")`, then `npm root -g` | not a dependency, not shipped | **unsupported**: the feature stays off (it already is off from npm installs unless the user installs `glimpseui`) |
| pi-coding-agent `jiti` extension loader, `pi-tui` native modules | `loader.js:17`, `native-module-path.js:4` | not used by tau | not exercised |

### P5: terminal (PASS)

`createLocalTerminalDaemon` used `piEnv.localDaemon()`, which is a `/$bunfs/...` path in a binary (terminals unavailable). With the daemon path passed explicitly (`new Connection({ command: [<path>] })`, temporary patch: env `P5_PI_ENV`), unsigned and signed: `GET /api/terminals/available` = `{"available":true}`, `POST …/terminals` returns `status: "running"`, the WebSocket stream returned `42marker`. Same on linux-arm64 and linux-x64-baseline (shell `sh`).

### P6: swap while the service runs (launchd PASS, systemd first CI run)

Scratch label `dev.tau.scratch.p6<n>` (bootstrapped into `gui/<uid>`, booted out after; the user's `dev.tau.server` untouched), scratch `--home`, `ProgramArguments[0]` = `…/p6/current/tau`, `KeepAlive`. `versions/a` and `versions/b` both signed.

```
first signed start, bootstrap -> health:       1.5 s    pid 21612   txt=versions/a/tau   current/tau --version = 0.0.0-p0
swap: ln -s versions/b current.tmp && mv -fh current.tmp current
  after the swap: same pid 21612, still txt=versions/a/tau, health {"ok":true}, plist sha unchanged
  current/tau --version now 0.0.0-p6b
launchctl kickstart -k gui/<uid>/<label>:      7.4 s to health (first run of signed b, machine under load)   pid 21772   txt=versions/b/tau   plist sha unchanged
rollback: swap back to a + kickstart -k:       pid 21900   txt=versions/a/tau   version 0.0.0-p0
bootout exit 0, no scratch process left
```

So `ROLLBACK_TIMEOUT_MS` = 60 s has a wide margin (worst measured 7.4 s). systemd is not available here (Docker has no systemd): the CI smoke job on `ubuntu-latest` runs the same sequence with a user unit `tau-scratch-<n>.service` under `systemctl --user` (`loginctl enable-linger` first), `ExecStart=<root>/current/tau serve …`: assert the pid and `/proc/<pid>/exe` unchanged after `mv -T`, then `systemctl --user restart`, then rollback.

### P7: linux binaries (PASS)

`bun-linux-arm64` and `bun-linux-x64-baseline` compiled (118.6 MB each); `docker run debian:13-slim` (arm64 native; amd64 under the Docker Desktop emulator): `uname -m` `aarch64` / `x86_64`, `tau --version` = `0.0.0-p7`, then the full driver: health, faux thread, terminal `running` with the explicit pi-env path (linux pi-env 2.1/2.4 MB). The `42marker` step needs `node`, which the image lacks, so the terminal check there is `status: running`. systemd and real x64 hardware stay with CI.

### P8: `process.execPath`, `import.meta.url`, `Bun.main` (PASS)

A compiled probe started directly, through `current -> versions/1`, through a second symlink and through `PATH` lookup, from a relative cwd: `process.execPath` is **always the realpath of the file** (`…/versions/1/tau`), on macOS and on linux (Debian 13: `/i/versions/1/tau` through `/b/tau -> /i/current/tau`). `argv0` is the typed path. `import.meta.url` = `file:///$bunfs/root/<outfile name>`, `Bun.main` = `/$bunfs/root/<outfile name>`, `argv[1]` = `/$bunfs/root/<name>`. Consequences, now in `install-paths.ts` and its tests:
- Detection `compiled()` = `import.meta.url` or `Bun.main` contains `/$bunfs/`.
- A server started before a `current` swap keeps `versionDir` = its own old `versions/<v>`, while `stableBinary` is `<root>/current/tau` (tested with a swap).
- Never use `argv[1]` for a binary: it is a virtual path.

## Foundation hand-off

### Frozen (do not change; ask the integrator)

- `packages/cli/src/runtime/install-paths.ts` (+ `.test.ts`): `compiled(probe?)`, `stableBinary(probe?)`, `versionDir(probe?)`, `installRootOf`, `stableBinaryOf`, `versionDirOf`, `definedVersion()`, `RuntimeProbe`. `stableBinary` and `versionDir` **throw outside a compiled binary**: call `compiled()` first.
- `packages/cli/src/cli-entry.ts`: `CliCommand { command; args }`; `cliEntry(argv?, execPath?, probe?)` returns `{ stableBinary, [] }` compiled, `{ node, [realpath(argv[1])] }` otherwise. The old `CliEntry`/`{node, entry}` type is gone.
- `packages/cli/src/version.ts`: `cliVersion()` = the `TAU_VERSION` define when compiled, else `package.json`.
- `scripts/build-binary.ts`: `pnpm build` then `mise exec -- pnpm build:binary --out <dir> [--target darwin-arm64|darwin-x64|linux-x64-baseline|linux-arm64] [--version v] [--no-sdk]`. Output = the archive's version folder: `tau`, `pi-env`, `web/` (contents of `packages/web/dist`, so `web/index.html`), `skills/` (contents of `core/src/skills/builtin`, so `skills/tau/SKILL.md`), `claude-sdk/node_modules/…`. Cross-target builds need the other platform's `pi-env` (in the package) and native SDK package (pnpm skips it on this host: CI installs per platform, or the release owner extends the script). Not signed, not archived.
- `.bun-version` = `1.4.2`. `packages/cli/package.json`: `"private": true`, `bin`/`files`/`publishConfig`/`engines` removed, version kept (0.4.0). `tsdown.config.ts` unchanged on purpose: the Node build for tests and e2e still copies `web` and `skills`; the binary is compiled from its `dist/bin.js` + `dist/watchdog.js`.
- Root `package.json`: `build:binary`, `smoke:binary` scripts added. `scripts/smoke-binary.ts` is an exit-1 stub.
- **Protocol: no change.** `install.mode` `run | manual | none` already covers binary (`run`) and dev checkout (`none`); no schema changed, no `bump-protocol`.
- Interface across owners (so both sides compile at the merge): `run.ts`'s dependency `cliEntry?: string` becomes `cliCommand?: CliCommand` (CLI owner), and `createCore` takes the same shape as `cliCommand?: { command: string; args: readonly string[] }` plus `assets?: { versionDir: string }` (core owner; `versionDir` is `undefined` outside a compiled binary). The CLI passes `cliEntry()` and `compiled() ? versionDir() : undefined`. Core never imports from cli.

### Stubs and compile-only edits left in the owners' files (replace them)

- `service/spec.ts`: `ServiceSpec.node = cli.command`, `entry = cli.args[0] ?? ""`. A compiled binary renders `[binary, "", serve …]`: wrong until the CLI owner makes the spec `{ command, args }`.
- `update/spawn-child.ts`: `request.cli.command`, `cli.args[0] ?? ""` (same fix).
- `serve.ts:69`: `cliEntry: cliEntry().args[0] ?? ""` (becomes `cliCommand: cliEntry()`).
- `service/manager.ts:159`, `lifecycle/deps.ts`, `update/updater.ts`, tests: type renames only. Test fixtures: `service/test-context.ts` `CLI = { command, args: [entry] }` and the `{...CLI, command|args}` spreads in six test files were rewritten mechanically.

### Owner CLI

Files: `cli/src/service/**`, `update/**`, `lifecycle/**`, `serve.ts`, `run.ts`, `static-dir.ts`, `commands/skill.ts`.
1. Spec, `render.ts:7,38,94`, `manager.ts` record and `needsRepair`, `install-or-repair.ts:40`, `status.ts`: `{ command, args }`; old `service.json` `{node, entry}` counts as a mismatch and repairs once (test).
2. `realpathSync(process.argv[1])` in `update/real-updater.ts:10`, `update/real-deps.ts:37`, `lifecycle/deps.ts:67`: **the compiled server crashes at start without this** (`lstat '/$bunfs/root/tau'`). Use `cliEntry()`.
3. `static-dir.ts`: add `join(versionDir(), "web")` when `compiled()`; `commands/skill.ts`: `join(versionDir(), "skills/tau/SKILL.md")`.
4. `serve.ts`: write `<home>/server.json { pid, versionDir }`; pass `cliCommand`, `assets` to `createCore`.
5. Updater for binaries, release check, swap, rollback (`ROLLBACK_TIMEOUT_MS`, worst measured start 7.4 s), retention, fake hooks, npm removal in the CLI (sections 6, 8).
Tests: the existing `pnpm --filter @pablopunk/tau test` stays green; new: old record repair, `buildSpec`/plist byte-identical after a swap, rollback sets `from`, release-check failure table (section 6).

### Owner core

Files: `core/src/cli-shim/**`, `create-core.ts`, `harness/terminal-daemon.ts`, `skills/**` (not the builtin `tau/SKILL.md`), `claude-cli/sdk-install.ts`, `claude-cli/sdk-port.ts`, `provider/provider-service.ts`.
1. `terminal-daemon.ts`: `new Connection({ command: [join(versionDir, "pi-env")] })` and the same path in `binaryUsable()` when `assets.versionDir` is set (measured: P5).
2. `sdk-port.ts`: when `assets.versionDir` is set, import `file://<versionDir>/claude-sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`; `createRequire(...).resolve` fails in a binary (P3). Keep the existing path for dev. `provider-service.ts:88` `sdkHome`. Decide what `authStatus` does when no `claude` is on `PATH` (P3 caveat).
3. `create-core.ts:135` shim from `{ command, args }` (`write-shim.ts:9`); remove `createNpmSdkInstaller`.
4. `discover-skills.ts`: add `versionDir/skills/tau/SKILL.md`.
Tests: `core` suite plus the contract suite; add a shim test (`exec <command> <args> "$@"`) and a `sdk-port` test that the compiled-path branch builds the `file://` URL.

### Owner release

Files: `.github/workflows/**`, `scripts/**` except `build-binary.ts`, `install.sh`, `packaging/**`, and **the root `package.json` scripts** (the foundation is done with that file; the owner removes `smoke:install`/`smoke:bare`).
1. `packaging/tau.entitlements` with the four keys of P1; `release.yml` per section 7; the Mach-O discovery step must fail on zero or unsigned hits (`claude-sdk` has exactly one today); decide re-sign vs keep Anthropic's signature on that file (P3).
2. P2 steps (above) in the macOS job; P6 systemd sequence in the linux smoke job; run the P1 smaller-entitlement check on `macos-latest`.
3. `scripts/smoke-binary.ts` (stub exists, overwrite), `install.sh`, `ci.yml` line, `setup-gh-secrets.sh`, delete `publish.yml`, `smoke-install.ts`, `smoke-bare.ts`.
4. Archive: the dir from `build:binary` for each platform. Size: darwin-arm64 version folder 387 MB on disk; the SDK part alone is 122 MB gzipped (the native `claude`, 256 MB, dominates).

### Owner web

`web/src/**`: update copy without npm (`UpdateButton`, `update-copy.ts`, `nodes/node-text.ts`, `NodesSection`) once the CLI owner fixes the `install.mode`/`command` semantics (`manual` keeps its text, `run` shows the button). Tests: `pnpm --filter @tau/web test`.

### Integrator notes

- Merge order: core, CLI, web, release. After each: `check`, `test`.
- The `cliCommand`/`assets` option names above are the only cross-owner contract: if an owner picks others, rename at the merge.
- `README`, release skill, builtin tau skill, `BARE-INSTALL.md`, `UPDATE-BUTTON.md` note, e2e rewrite, `binary.spec.ts` are the integrator's (section 11). The e2e `binary.spec.ts` needs `web/` served: it works only after CLI item 3.
- The temporary pin patches are not in the branch; the exact diff of the three kinds is described in the P5, P3 and section 4 rows. The faux driver scripts lived in `/tmp` and are not kept; `binary.spec.ts` and `smoke-binary.ts` replace them.
- Open for the owner of the machine: P2 (needs the Apple secrets), P6 systemd, the older-macOS entitlement check (all "first CI run").

## Integration

Applied: the four integrator notes (deleted). `claude --version` falls back to the SDK's bundled native `claude` (before `PATH`, like `authStatus`); `smoke:binary` no longer skips the SDK import step and passes. The updater and `install.sh` agree on `tau-<v>-<os>-<arch>.tar.gz` (one top folder, `SHA256SUMS` lines `<sha256>  <archive>`, `linux-x64-baseline` shipped as `linux-x64`). The e2e `update-button.spec.ts` and the new `binary.spec.ts` compile real binaries (`e2e/binary-support.ts`, cached per CLI build), install them with `install.sh` into a scratch `TAU_INSTALL_DIR`, serve two fake releases plus a broken one through `TAU_RELEASES_API`, and run detached with stub `launchctl`/`systemctl` so no real unit is ever registered. They cover Update, the confirm dialog, a real update, 403 for a paired device, no button in a dev checkout, and rollback from a release whose `tau` only answers `--version`. The "Update" copy and `tau connect` refusal say `tau update`. README, the release skill, the builtin tau skill and `UPDATE-BUTTON.md` are updated; `BARE-INSTALL.md` and `scripts/fake-service-manager.mjs` are deleted.

Bug found by the rollback e2e and fixed: on a node where the service manager refuses the install (launchd without a GUI session), `tau restart` and the updater installed and restarted, which started two servers. They now keep a running detached tau (`installOrRepairService(..., { keepDetached: true })`).

Still unverified (first CI run): notarization, the systemd swap, `ubuntu-24.04-arm`, and a darwin-x64 smoke. No unit test covers `keepDetached` (the e2e does).

## Review history

- Round 3 (24302): APPROVE. Minor items applied: `server.json` instead of `service.pid`, P3 on a signed copy, wording of the risks, rollback timeout as a constant.

- Round 2 (24302): CHANGES REQUIRED. Fixed: SDK natives pruned per platform, every Mach-O found and signed (Bun-based ones with the JIT entitlements), P3 on a signed copy, ownership of `run.ts`, `static-dir.ts`, the builtin skill and `smoke:binary`. Also: rollback checks `current === target`, the server records its `versionDir`, `$bunfs` detection, e2e stays on the Node build, `contents: write`, `TAU_INSTALL_DIR` scope, old `service.json` record, two wrong paths.

- Round 1 (24302): CHANGES REQUIRED. Fixed: two-path install layout, Bun's full entitlements, no `spctl` on bare binaries, protocol mismatch during migration, PATH shadowing and the shim, complete removal list, SDK decided (ship it), rollback owner and retention, draft releases, CI runners and pi-env source, tag/version check.
