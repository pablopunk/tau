# tau as a signed Bun binary (no npm)

Status: draft v3, after review rounds 1 and 2 (agent 24302). Evidence: the validation report of 2026-10-20 (agent 24021), quoted as **[V]**; the review, quoted as **[R#n]**.

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
| `service/spec.ts`, `render.ts:7,38`, `manager.ts:102,104` (`needsRepair`) | `binary binary serve` | render and compare `{ command, args }`; `command` = `stableBinary` | CLI |
| `core/cli-shim/write-shim.ts:9`, `core/create-core.ts:135` | `exec tau tau "$@"` **[V]** | shim from `{ command, args }` | core |
| `static-dir.ts:5`, `discover-skills.ts:81`, `commands/skill.ts:5` | web UI and skills missing | `versionDir/web`, `versionDir/skills` | core / CLI per folder |
| `terminal-daemon.ts:49,56` pi-env `localDaemon()` | `/$bunfs/bin/...`, terminals `available:false` **[V]** | `new Connection({ command: [versionDir + "/pi-env"] })` **[V]** | core |
| `claude-cli/sdk-port.ts:264,272` `createRequire(import.meta.url).resolve` | dev fallback unverified in `/$bunfs` **[R#7]** | resolve from `versionDir/claude-sdk` when compiled | core |
| `claude-cli/sdk-install.ts:27` `execFile("npm")`, consumer `createNpmSdkInstaller` in `create-core.ts` **[R#15]** | npm missing | removed: the SDK ships in the archive (section 5) | core |
| `serve.ts:27` watchdog URL, `start-watchdog.ts:30` | works if the worker is an entrypoint **[V]** | keep; build passes both entries | — |

The foundation runs `grep -rn "argv\[1\]\|import.meta.url\|process.execPath\|createRequire\|__dirname" packages/*/src --include=*.ts` (tests excluded) and adds any further hit to this table before the hand-off.

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

## Review history

- Round 3 (24302): APPROVE. Minor items applied: `server.json` instead of `service.pid`, P3 on a signed copy, wording of the risks, rollback timeout as a constant.

- Round 2 (24302): CHANGES REQUIRED. Fixed: SDK natives pruned per platform, every Mach-O found and signed (Bun-based ones with the JIT entitlements), P3 on a signed copy, ownership of `run.ts`, `static-dir.ts`, the builtin skill and `smoke:binary`. Also: rollback checks `current === target`, the server records its `versionDir`, `$bunfs` detection, e2e stays on the Node build, `contents: write`, `TAU_INSTALL_DIR` scope, old `service.json` record, two wrong paths.

- Round 1 (24302): CHANGES REQUIRED. Fixed: two-path install layout, Bun's full entitlements, no `spctl` on bare binaries, protocol mismatch during migration, PATH shadowing and the shim, complete removal list, SDK decided (ship it), rollback owner and retention, draft releases, CI runners and pi-env source, tag/version check.
