# Bare `tau` means "install it and keep it running"

Status: plan, not implemented. Do not commit. Paths are under `packages/cli/src/` unless noted.

## 1. Scope and behaviour

**In**: `npx @pablopunk/tau` (no args) installs itself globally and as an OS service; bare `tau` never serves in the foreground; detached `restart` actually restarts; truthful `tau status`; migration of old npx-detached users; `tau connect` follow-up; README and help.
**Out**: Windows auto-update (stays manual, install-method.ts:53), changing `tau update`'s own flow, the sidebar Update button (UPDATE-BUTTON.md), a `--yes` flag (there is no question).

Rules: foreground is only `tau serve`. Any failure exits 1 with the exact command to run. Running again is safe.

Copy (`<url>` is `http://127.0.0.1:<port>/?token=<token>`, always printed, also with `--no-open`):

First run via npx, macOS:
```
Installing tau 0.9.1 globally: npm i -g @pablopunk/tau@0.9.1
<npm output>
Installing the tau service (launchd)...
tau is running as a service. It starts at login and restarts if it crashes.
Open: <url>
To use tau from your phone or another device, run: tau pair
```
Linux: same, `(systemd)` instead of `(launchd)`; the linger warning from systemd.ts:25-27 follows if it applies.
Re-run, already running: `tau 0.9.1 is already running as a service.` then `Open:` and the pair line. The browser opens unless `--no-open`.
Re-run with a stale service (other node or entry, or running version differs from this CLI): `Repairing the tau service...` then restart, then the lines above.
No service manager (see 3): `No service manager here. tau runs in the background and will not survive a reboot or logout.` then `Open:` and the pair line. Exit 0.
Failures (exit 1):
- global install: `Could not install tau globally. Run: npm i -g @pablopunk/tau@0.9.1` (EACCES/EPERM reuses `permissionText`, update-text.ts, with `manual`).
- no npm/pnpm found: same line with the command to run.
- service install: `Could not install the tau service: <reason>. Run: tau service install` (to debug: `tau serve`).
- not answering after start: `tau did not start. Run \`tau logs\`.` (start.ts:10). The wait is up to 60 s; after 3 s it prints once `Waiting for tau to start...` so the terminal does not look hung.
- another tau in a terminal holds the home: `tau is already running in a terminal (pid N). Stop it (Ctrl+C), then run tau again.`
- `tau` not on PATH after install: a note, not a failure: `Open a new terminal (mise: run \`mise reshim\`) to use \`tau\`.` (install-method.ts:71 hint).

The QR code stays only in `tau pair` (commands/pair-flow.ts:80-81). Bare prints no QR.

## 2. Design per file

**Bootstrap (npx to global)** — new `lifecycle/bootstrap.ts`, called first in `runBareWith` (lifecycle/bare.ts:13) and used by `bareHandler` (main.ts:48).
1. `temporaryRunnerOf(entry)` replaces `isTemporaryRunnerEntry` (service/entry-guard.ts:8-9): returns `"npx" | "pnpm" | "bun" | undefined`. Merge the regex in install-method.ts:41 into it (they differ today: `/dlx/` vs `dlx-*`, `pnpm/dlx`). Keep `TemporaryEntryError` for non-bare commands.
2. If undefined: skip bootstrap (global, mise, dev checkout).
3. Pick the manager: npx or bun -> `npm i -g` (service runs node, so npm is the right owner; bunx hands over to npm from PATH); pnpm dlx -> `pnpm add -g` if pnpm answers, else npm. Use `npmOf(execPath)` (update/latest-version.ts) for npx. Spec is `@pablopunk/tau@<cliVersion()>` (deps.version, deps.ts:12).
4. Find the global package dir with `npm root -g` / `pnpm root -g` (extract from run-update.ts:36-44 `planOf` into new `update/global-package.ts`, so both use it). If a global tau already has a version >= this one (`compareVersions`, protocol), skip the install and hand over (never downgrade; print one note). Else run the install with `deps.runCommand(..., {stdio:"tee"})` (command-runner.ts:23).
5. `verifyInstall(deps, packageDir, version, home)` (verify-install.ts:21) before handover. It runs `status --json` on the new binary, so a broken install is caught before the service points at it.
6. Handover: `runCommand(node, [entryOfPackage(dir), ...argv], {stdio:"inherit", env:{...cleanEnv, TAU_BOOTSTRAPPED:"1"}})`, return its exit code as ours. `node` is `process.execPath` only when it is node (`process.versions.bun` unset); under bunx it is `node` resolved from PATH, and with no node on PATH bare exits 1 with the manual command. `npmOf` uses the same node. The env var stops any loop (a bootstrapped entry that is still temporary is an error). Bare deletes `TAU_BOOTSTRAPPED` from `process.env` right after reading it, before any service install or start, so the unit and its children never inherit it.
6b. Clean env for the install and the handover: drop every `npm_config_*`, `npm_lifecycle_*`, `npm_package_*` and `npm_execpath` that npx sets, so the install targets the real global prefix. Only the smoke's `npm_config_prefix` survives, and only when `TAU_BOOTSTRAP_SPEC` is set.
6c. Windows: `spawnCommand` (command-runner.ts:23) uses no shell, so bootstrap resolves `npm.cmd` / `pnpm.cmd` explicitly on win32. Windows is not in CI: any failure there prints the manual command.
7. Test seam for the smoke: `TAU_BOOTSTRAP_SPEC` overrides the install spec (internal, undocumented).

**Bare flow** — `lifecycle/bare.ts:13-35` rewritten. Remove the `serveInForeground` parameter and the catch at :20-23; `main.ts:48` becomes `(argv) => runBare(argv)`. Order: bootstrap, flags + stored port (:15-16), then:
- `needsInstall = native ? (!installed || needsRepair) : detachedStale`. Idempotent: a detached home is "installed" via its record file, not re-installed each run (detached.ts:42 `isInstalled` is always false, so `needsRepair` manager.ts:81-85 would be false for it; add `recorded()`-based staleness for the no-native case).
- install failure becomes the service failure message above; `TemporaryEntryError` cannot happen after bootstrap (a leftover one prints the `npx @pablopunk/tau` hint).
- instance running with `version !== deps.version()` -> `manager.restart()` ("Repairing"), else `startAndWait` (start.ts:7-12).
- print per section 1 using `withToken` (deps.ts:23); open the browser via `openRunning` (open.ts:5) which stops printing the URL a second time. Add `ServiceManager.kind` / `native: boolean` (manager.ts:16-29) so bare can word the detached case.
- Texts in one new file `lifecycle/bare-text.ts` (as update-text.ts does).

**Restart bug** — detached.ts:33-37 `stop` sends SIGTERM and returns; :54-57 `restart` then calls `start`, which returns at :24 because the pid is alive. Fix in the backend:
- Which pid: the target is the pid in `service.pid` only when it equals `readRunningInstance(home).pid` (the live lock). If the pid file is missing, use the lock pid only when the lock's process is a `--service` server: `ps -o command= -p <pid>` (fallback `ps -o args= -p <pid>` for busybox) contains `--service` (new `ServiceContext.commandOf(pid)`, fake in tests). An empty, truncated-without-match or failed result means "not a service server": never signal it. This works for servers from old versions, which never get a new lock field. On win32 there is no check: the process is treated as foreground. A foreground holder is never signalled; bare prints the terminal message from section 1. A pid file that does not match the live lock pid is stale (pid reuse after a reboot): remove the file, signal nothing through it, then apply the missing-pid-file rule to the lock's server. So migration cannot loop: each run either stops a verified `--service` server or stops with the foreground message.
- `stop` waits for exit: SIGTERM, then poll every 100 ms until the lock is gone and the pid is dead, up to 20 s, then re-read the lock and SIGKILL only when the same pid still holds it (a replacement server that took the lock is never killed), up to 2 s more, then remove the pid file. After 2 s of waiting it prints once: `Waiting for tau to stop (it is closing its threads)...`. Needs `ServiceContext.sleep` (context.ts:6-18, injectable; fake in tests) and `ServiceContext.kill(pid, signal)` (context.ts:44 hardcodes SIGTERM).
- `start` remains a no-op when alive; `restart` = waited stop, then spawn. The new `--service` server also waits for a free home (serve.ts:54, wait-for-lock.ts:16) as a backstop; do not rely on it alone, since `tau restart` would print success while waiting.
- SIGKILL skips the exit cleanup: verified, `readLiveLockInfo` ignores a lock whose pid is dead and `acquireHomeLock` takes it over (core/src/home/lock.ts:53-56); the OS frees the port.
- `tau stop` (lifecycle/stop.ts) uses the same waited stop, so "stopped" is true. `tau update` is fixed for free: restart-step.ts:31 runs `restart`, then polls the target version (:37).
- If the home is held by a foreground `tau serve` (instance pid != managed pid), `restart` fails with the terminal message above instead of spawning a process that waits forever.

**Status wording** — lifecycle/status.ts:7 `running: "service" | "foreground" | false` gains `"background"`; :33 `isService` also requires `state.kind !== "detached"` (manager.state() already returns `kind`, manager.ts:118-121). `renderStatus` (:55): `running (service)`, `running (background, not a service: it stops at reboot, run \`tau\` to install it)`, `running (foreground)`. JSON is additive. restart-step.ts:25-26 treats background as restartable; run-update.ts:138 (`running === "service"` refuses on running work) must include background.

**Detached for bare** — decision: allowed (containers and Linux without a user session are real, refusing would make tau unusable there), never silent, exit 0, copy in section 1. Source of the cases: pick-backend.ts:12 (`XDG_RUNTIME_DIR` unset), launchd.ts:40-45 and manager.ts:71-75 (`fellBack`). Message for Linux adds: `To start it at boot: enable a systemd user session (loginctl enable-linger $USER), then run tau again.`

**Migration** — old npx users have a detached server from `_npx` (start.ts:8 does `manager.start()` with no guard; `service.pid`, maybe a stale `service.json`) or a foreground `serve`. Today only `uninstall()` stops the detached process (manager.ts:~99); `install()` (manager.ts:~88-98) does not. New: `install()` starts with the waited detached stop (same pid rules as the restart fix: `service.pid` verified against the lock, else the lock pid of a `--service` server) before the native install, because the new `--service` process otherwise waits forever on the lock. Foreground holder: terminal message (can't kill another terminal's process). Also add `refuseTemporaryEntry` to `start`/`restart` when they would spawn detached from the spec (manager.ts:105-116): no more npx-cache detached servers; message `Run: npx @pablopunk/tau`. A stale service naming an npx entry is repaired by `needsRepair` (manager.ts:81).

**mise** — the unit stores `cli.node` and the realpath entry (cli-entry.ts:15-17, spec.ts:26-31) under `~/.local/share/mise/installs/node/<v>/`. A later node switch removes it; `tau status` already flags `node missing` (status.ts:30). Decision: keep recording real paths (a shim would run whichever node is current, with a different global prefix and no tau). Repair is `npx @pablopunk/tau` again (bare repairs, section 1). Add one line after install when the entry matches `SHIM_MANAGERS` (install-method.ts:29): `tau is installed under mise node <v>. If you change node versions, run npx @pablopunk/tau again.` PATH for agents already prefers mise shims (path-capture.ts:7-15).

**connect** — commands/connect-command.ts:70-81 and nodes/connect-io.ts:24-29: drop the `serve` choice and `AfterLink` "serve". Prompt becomes `tau is not running here. Install it as a service and start it? [Y/n]`; yes calls `runBare(["--home", home, "--no-open"])` (so it bootstraps from npx too); no prints the :79 hint. `--yes` stays `none`. Update connect-command.test.ts.

**Docs** — README.md:25-29 "Run": explain that `npx @pablopunk/tau` installs and runs tau as a service, then `tau pair`; `tau serve` is for debugging. commands/help.ts:13 `serve` line: "Run the server in the foreground (debugging only)"; add a bare line "tau  Install the service, start it, open the browser". README mentions `tau update` for later versions.

## 3. Install-method matrix

| Where it runs | Bare does |
|---|---|
| npx (`_npx`) | `npm i -g` of this version, verify, hand over, service |
| pnpm dlx | `pnpm add -g` (else npm), same; pnpm without `PNPM_HOME` -> manual command message |
| bunx | `npm i -g` from PATH, same; no npm -> manual command |
| npm global | no install; service (repair if stale) |
| pnpm global | same |
| mise (npm layout under mise installs) | same plus the mise line |
| dev checkout (`packages/cli/dist/bin.js`) | service pointing at the checkout, as today; use `--home` to avoid touching `~/.tau` |
| Windows | same bootstrap with `npm i -g`; schtasks if headless conhost else detached (pick-backend.ts:13-14); not covered by CI, manual command on any failure |
| volta | no bootstrap (not temporary); service as today |

## 4. Failure modes

- Registry or network down: install fails, section 1 message, exit 1, nothing half-written (service untouched until verify passes).
- Install ok but `verifyInstall` fails: print its problem (`verifyFailedText`) plus the manual command; no handover.
- Global dir not writable (EACCES/EPERM): permission text plus a way out without sudo: `Or install to your home: npm i -g --prefix ~/.local @pablopunk/tau@<v>, add ~/.local/bin to PATH, then run tau.` No sudo suggestion.
- Port taken: `resolvePort` behaviour unchanged; failure shows via `tau logs` message.
- launchd/systemd refuse: launchd already falls back to detached with a warning (launchd.ts:40-45); systemd errors become the service failure message (no silent detach, except no-session case above).
- Two `npx` runs at once: the second sees the global at an equal version and skips the install; the manager calls are idempotent. A second npm install racing the first is possible and accepted.
- Handover child killed (Ctrl+C during npm): exits non-zero; re-run is safe.

## 5. Test plan

Unit (Vitest, existing fakes: service/fake-runner.ts, fake `ServiceContext`):
- entry-guard: runner kinds for each path form.
- bootstrap: fake `runCommand` records the exact install command per runner; skip when global is newer or equal; verify failure blocks handover; env var stops loops; handover exit code is propagated.
- bare: install ok, already running (nothing but print), stale (restart), detached no-native (warning, exit 0, no repeat install), install throws (message, exit 1, no foreground call), foreground holder, token URL printed, no QR.
- detached: fake `isAlive`/`sleep`/`kill`: restart waits, SIGKILL after the timeout, spawns after exit; stop removes the pid file.
- status: detached state renders `background`; native active renders `service`.
- connect: no `serve` option; yes calls bare.

Smoke `scripts/smoke-bare.ts` (modelled on smoke-install.ts, scripts/smoke-install.ts:30-45; run with `mise exec -- pnpm`): packs the CLI, then in a scratch dir sets `HOME`, `TAU_HOME`, `npm_config_prefix` (global install target) and a random free port, all inside it. `PATH` gets scratch `bin/` first, holding `launchctl`, `systemctl`, `loginctl` fakes from `scripts/fake-service-manager.mjs`: they log calls, return success, and on `bootstrap` / `start` read the plist or unit `ProgramArguments` / `ExecStart` and spawn that command detached (so the server really starts, on the scratch port), and answer `print` / `is-active` from the live pid. The real `~/.tau`, `~/Library/LaunchAgents`, `~/.config/systemd` and running tau ports are never touched: the script aborts at start if `HOME` or `TAU_HOME` resolves outside the scratch dir, and it copies the tarball into a fake `_npx/` folder to start from. `TAU_BOOTSTRAP_SPEC` points the install at the tarball. Runs: first run (global bin exists, plist/unit written in scratch HOME, health ok, URL printed), re-run (same pid), stale record (changed entry -> restart, new pid), `restart` (new pid), no-manager run (`XDG_RUNTIME_DIR` unset: detached), migration (pre-start a detached server from the `_npx` copy, run bare, old pid gone). Cleanup kills only pids it spawned.
e2e/ (Playwright) is unchanged; `pnpm check`, `test`, `build` must pass.

## 6. Work split (AGENTS.md workflow)

1. **Foundation** (one agent): `main.ts:48` (`bareHandler` with the new `runBare(argv)` signature, frozen here), `update/install-method.ts:41` regex merge, `lifecycle/deps.ts` additions, `entry-guard.ts` runner kinds, `ServiceContext.sleep` + `kill(pid, signal)`, `ServiceManager.kind/native`, `StatusReport` `"background"`, bootstrap deps interface and stubs, `bare-text.ts` constants, fake updates, `ServiceContext.commandOf`, and the waits that must outlast a 22 s stop plus startup: `waitForUrl` in lifecycle/wait-for-lock.ts:35-43 (today 60 x 250 ms, about 15 s; raise to at least 60 s). It serves `startAndWait` (start.ts:10) and `tau restart` (restart.ts:12). `pollInstance` (`POLL_DEADLINE_MS = 60_000`, update/real-deps.ts:15) is already 60 s: no change. UPDATE-BUTTON's restarting window is also at least 60 s. Done when check, test, build pass.
2. **service/** owner: detached.ts restart/stop, manager.ts (migration order, temp refusal on start/restart, detached staleness), path/mise line, their tests.
3. **lifecycle/ + update/** owner: bootstrap.ts, bare.ts, status.ts, stop.ts, restart.ts messages; `update/global-package.ts` extraction from run-update.ts, restart-step.ts and run-update.ts:138 for `background`; tests.
4. **commands/ + nodes/** owner: connect-command.ts, connect-io.ts, tests.
5. **docs + scripts** owner: README.md, help.ts, `scripts/smoke-bare.ts`, `scripts/fake-service-manager.mjs`, root package.json script `smoke:bare`.
6. **Integrator**: merges each branch in turn, runs check and test after each, then `smoke:bare` and `smoke:install`, then verifies for real in a browser on a scratch home.
Overlap with UPDATE-BUTTON.md: its detached updater runs in its own session, so the waited stop does not kill it, but its "restarting" poll window must exceed the worst-case waited stop (20 s + 2 s) plus startup: use at least 60 s. Both touch restart-step.ts and `running` values (`foreground` text at restart-step.ts:25), and its detached `tau update` benefits from the restart fix. Land this plan first or rebase; do not merge the plans.

## 7. Open questions

1. Detached for bare: allowed with a warning and exit 0 (recommended), or exit 1 outside known containers?
2. Always print the token URL (also with `--no-open`, in CI logs)? Recommended yes: it is the sign-in link and stays on the user's terminal.
3. mise: keep recording the real node path with a warning (recommended), or pin the unit to the mise `node` shim?
4. `TAU_BOOTSTRAP_SPEC` as an internal test seam (recommended), or a fake registry in the smoke (heavier, proxies every dependency)?

## Review round 1

Verdict: CHANGES NEEDED (no blockers in the design; 2 med claims wrong or missing, rest low).
- med: "manager.ts:99 order reused" is wrong for install. manager.ts install() (:~88-98) never stops a detached process; only uninstall() does (`detached.stop`). Migration step must be added to install(), and must be a waited stop (kill the pid from `service.pid`, and from the lock if the pid file is missing).
- med: SIGKILL escalation on a pid file is dangerous. `livePid` (detached.ts:19) trusts any live pid in service.pid; after reboot the pid can belong to another process. Verify the pid equals the lock's pid (`readRunningInstance`) before SIGKILL, or only kill when they match.
- med: 10 s SIGTERM budget can kill a server that is still shutting down agent threads. Make it 15-20 s or until the lock disappears, and say so in the restart output.
- med: bunx handover. Under bunx `process.execPath` can be bun; step 6 says "execPath-or-node". Handover and `npmOf` must use a real node (PATH `node`, else refuse with the manual command), because the unit records `cli.node`.
- low: npm global install from inside npx inherits npm_config_* env from npx; pass a cleaned env (drop npm_config_global/prefix unless the test seam sets it) so the install target is the real global.
- low: EACCES leaves the user with no path to "works forever". Add the `--prefix ~/.local` hint next to permissionText (no sudo).
- low: ENV `TAU_BOOTSTRAPPED` must be stripped when bare starts the service, or the unit/children inherit it.
- low: Windows: `spawnCommand` (command-runner.ts:23) has no shell; `npm`/`npm.cmd` is not found by spawn. Resolve to `npm.cmd` or say it is the manual-command path only.
- low: work split gaps. main.ts:48 (bareHandler), install-method.ts (regex merge, :41), deps.ts have no owner; the runBare signature change must be frozen in Foundation or commands/ owner cannot compile. Assign main.ts + install-method.ts to Foundation.
- low: UPDATE-BUTTON: its detached updater is its own session (spawnDetached detached:true), so the waited stop of only the server pid does not kill it. OK. But the 15 s update-job restart timing now includes the waited stop (up to 12 s): its 'restarting' grace/poll must be > that.
- verified: readLiveLockInfo ignores dead pids (core/src/home/lock.ts:53-56; acquireHomeLock takes over a stale lock), so SIGKILL leaves no blocker; the port is freed by the OS. waitForFreeHome (serve.ts:54) is only a backstop; no race if stop waits first.
- verified: detached `isInstalled` is false (detached.ts:42), manager.restart uses detached when not installed (manager.ts:~108), launchctl/systemctl/loginctl are called by bare name via PATH (launchd.ts:15, systemd.ts:15), so scratch fakes work; osHome uses os.homedir() so HOME scratch works.
- verified: bare.ts:13-35, start.ts:10, serve.ts:54, restart-step.ts:25, run-update.ts:138 claims match.

## Review round 2

Verdict: CHANGES NEEDED (one med gap, two low).
- med: "lock pid of a `--service` server (not a foreground `tau serve`, see below)" has no "below". The lock only holds `{pid,url,version}` (core/src/home/lock.ts:4-10, `publishUrl` :47-48), so it cannot tell the two apart, and servers from old versions (exactly the migration case) will never carry a new field. Fix: pick one and write it down. (a) `ps -o command= -p <pid>` contains `--service` (unix; on win32 skip and treat as foreground); works for old servers. (b) add `service: boolean` to the lock: touches core (`publishServerUrl` running-instance.ts:11, run.ts) which no work-split owner has; add it to Foundation if chosen. Recommend (a) for the fallback and (b) not at all. Also state the rule when the pid file exists but the live lock pid differs (stale file removed, lock server untouched) so migration does not loop.
- low: the fresh-pid check races: pid file and lock are read separately; re-read the lock after SIGTERM and only SIGKILL if the same pid still holds it (avoids killing a replacement that took the lock).
- low: 20 s + 2 s stop plus startup: `tau restart`/`tau update` callers with fixed timeouts (restart-step pollInstance, start.ts wait) must be checked; the plan only raises UPDATE-BUTTON's window. List pollInstance's timeout as a Foundation item.
- ok: stop/lock ordering with `waitForFreeHome`, env clean (6b), bunx node, npm.cmd (6c), unowned files now in Foundation, EACCES hint.

## Review round 3

Verdict: CHANGES NEEDED (two low line-reference fixes; design approved).
- low: the timeouts are not at restart-step.ts:37 or start.ts:10. Those only call `deps.pollInstance` / `deps.waitForInstanceUrl`. The real limits are `POLL_DEADLINE_MS` (update/real-deps.ts, used at :18-21) and `waitForUrl` (lifecycle/deps.ts:38 -> its own helper). Foundation should edit those, and `tau restart`'s wait (lifecycle/restart.ts:12) goes through the same `waitForInstanceUrl`.
- low: `commandOf` via `ps -o command=` can be truncated or empty on some systems (busybox ps has no `-o command=`; use `-o args=` fallback). Treat an empty/failed result as "not a service server" (never signal), and say so in the plan.
- ok: pid-file mismatch rule, no-loop migration, same-pid re-read before SIGKILL, win32 as foreground.

## Review round 4

Verdict: APPROVE. waitForUrl is only reached through lifecycle/deps.ts:38, so raising its default (attempts 60 x 250 ms) is local; the failure message `tau did not start` now appears after up to 60 s, acceptable (print a "Waiting..." line). commandOf fallback and never-signal-on-empty are consistent with the pid rules.
