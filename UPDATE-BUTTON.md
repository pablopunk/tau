# Update button in the sidebar

Status: integrated on the detached backend; systemd and launchd restart-survival still unverified (see Integration).

Fixed decisions: check every 15 min; npx-cache installs show a copy command and run nothing; owner only (403 for paired devices and linked nodes); after success the page reloads by itself, then a short toast with the new version; the detached updater must survive the service restart on systemd and launchd in v1.

## 1. Scope and behaviour

**In**: 15 min check that only reports installable versions; an `Update` button right of Settings; confirm dialog; detached updater; progress, reconnect, reload, failure with log tail; per-install-method behaviour (section 3).
**Out (v1)**: updating linked nodes, auto-update, rollback, release notes, Windows/bun/volta auto-run (command only).

Behaviour (the button is driven by three separate inputs, never one flag):
- `canUpdate` (server-computed) = the caller is the owner. Nothing else.
- Show the button only when `canUpdate` is true **and** either (`behind && install.mode !== "none"`) or `job.state` is `installing`, `restarting` or `failed` (a failed job shows even if `behind` is now false). Non-owners never see the button, in any state.
- `install.mode === "run"`: click → confirm dialog → update. `install.mode === "manual"` (npx, Windows, bun, volta, and any backend whose verification has not passed, see section 5): click → command dialog; nothing runs. This is how an npx user gets a button.
- Disabled while `job.state` is `installing` or `restarting`: label `Updating…`.
- Every page records `status.current` when it first loads. When a later status reports a different `current`, the page reloads once (owner or not, any tab). The tab that started the update then shows the toast "tau updated to 0.9.1".
- `failed`: label `Update failed`; click shows the log tail and `Retry` (Retry only when `install.mode === "run"` and behind). The label clears when `current` changes (e.g. a manual `tau update` from the CLI), when `target === current`, or on the next start.

Copy:
- Title "Update tau to 0.9.1?"; body "You have 0.9.0. tau will restart and the page reconnects in under a minute." For a foreground run (`gatherStatus().running === "foreground"`, restart-step.ts:25) the restart sentence is replaced by "tau was not started as a service, so it will not restart. Restart it yourself afterwards."
- Running work: "2 threads and 1 subagent are running. They will be stopped. Threads with timers or a goal resume afterwards."
- Buttons `Cancel`, `Update and restart` (with running work `Stop work and update`).
- Manual dialog: "Update tau" / "This tau can't update itself: {reason}" + command + copy button.
- Progress: `Installing 0.9.1…`, `Restarting…`; failure `The update failed.` + log tail.

## 2. Design per package

Verified facts: `UpdateService` timer is lazy (update-service.ts:66-69), 6 h (`:3`), 60 s gap (`:4`), failed checks keep the old value (`:51`). `Core.updates` at protocol/src/core.ts:413-418; `latestVersion` injected at core.ts:436 and wired at create-core.ts:342-344, 433; CLI passes it at run.ts:74. Routes at protocol/src/rest.ts:181-187, handlers at server/src/rest/register-routes.ts:17-18; `every-route.test.ts:12-29` fails on an unregistered route. `defineRoute` (server/src/rest/define-route.ts:23-24) calls `reply.code(route.status)` for any status, so 202 works; it has no per-route options yet. Web hooks at web/src/lib/queries.ts:395-418 (`web/src/lib/updates.ts` does not exist). Footer at web/src/sidebar/AppSidebar.tsx:123-128.

### protocol (foundation owns every file here)
- `errors.ts`: add `forbidden` (403), `update_busy` (409), `update_unsupported` (422) to `ERROR_CODES` (`:3-30`), `ErrorCodeSchema` (`:34-61`) and `ERROR_STATUS` (`:68-95`); update `server/src/error-codes.test.ts` and `server/src/error-handler.ts` (foundation owns both). Codes are snake_case; there is no `forbidden` today.
- `updates.ts`: extend `UpdateStatus` (additive):
  - `canUpdate: boolean`: server-computed, true only for the owner (`deviceId === OWNER_DEVICE_ID`). It does not include install mode, behind or job state; the web combines those itself (section 1).
  - `install: { mode: "run" | "manual" | "none", command: string | null, reason: string | null }`.
  - `job: { state: "idle" | "installing" | "restarting" | "failed", target: string | null, error: string | null, logTail: string | null }` (the job file's `from` is internal: it is not in the protocol type and never sent to the web).
  - Non-owner callers get `canUpdate: false`, `install.command = null` and `job.logTail = null` (logs can hold paths and registry URLs); the web never shows the button to them (they still reload when `current` changes, section web).
- `rest.ts`: `startUpdate: POST /api/update/start`, status 202, body `UpdateStartBodySchema = Type.Object({ target: Type.String(), force: Type.Boolean() }, { additionalProperties: false })`, response `UpdateStatusSchema`. `target` is the version the dialog showed.
- `core.ts`: `updates.start({ target, force })`.
- Move `lineageOf` (pure, cli/src/commands/own-thread.ts:8-) and `runningWorkOf` (cli/src/update/running-work.ts:12-19) into protocol; `own-thread.ts` keeps its CLI-only guard (it imports `./client`, `./cli-exit`, so the file itself does not move). CLI re-exports. Foundation edits `cli/src/update/running-work.ts` (re-export of `runningWorkOf`) and `cli/src/commands/own-thread.ts` (imports and re-exports `lineageOf` from protocol); no other agent touches those two files.
- **Protocol hash.** `protocolSurface()` hashes `routes` (protocol-version.ts:31-38), so the new route and the new response fields change `computeProtocolVersion()` and the hash changes in the foundation commit only. Today a mismatch makes the linked node `update-required` (core/src/nodes/status.ts:15, set from create-nodes.ts:88) and skips its change events (`create-nodes.ts:346`). Updating one node therefore marks its peers as "update required" until they are updated too. This is acceptable and is the same state every route-changing release already produces; the real answer for the user is "Update tau on <node>", done from that node's own page (the link `linkSurface()` frames, `:40-42`, are unchanged, so the link itself stays up). Cost, stated plainly: while a peer is mismatched its threads go stale in the sidebar until that node is updated. Test (core, `core/src/nodes`): two cores with different `protocolVersion` values → the peer status is `update-required` and `writeSummary` does not store its summaries (create-nodes.ts:346); then give both the same version → the peer is `online` again and summaries are written. Local `updates.status/start` keep working throughout.

### core (`packages/core/src/updates`)
- `update-service.ts`:
  - `REFRESH_EVERY_MS = 15 * 60_000` with ±10% jitter, scheduled by a chained `setTimeout` (re-armed after each check, `unref()`ed, cleared by `stop()`), not `setInterval` (update-service.ts:60 uses `setInterval` today).
  - New option `autoStart` (default `false`; `run.ts` sets `true`). When true the first check and the timer start at creation; tests never hit `latestVersion` unless they opt in. `stop()` clears the timer; `create-core.ts` close path already calls it (`:438`).
  - Deps `updater: { plan(target): InstallInfo; spawn(job); readJob() }` from the CLI (core cannot run npm). `plan` is synchronous: the updater runs the `systemctl --version` probe once when it is created (async, awaited in `run.ts` before `createCore`) and caches the result, so `plan` only reads the cached value.
  - `start({target, force})`: `update_unsupported` unless `install.mode === "run"` and `target === latest` and behind; if a job is `installing`/`restarting` return the status unchanged; `update_busy` when `runningWorkOf` is non-empty and not `force` (ignoring the caller's own lineage only for CLI calls).
  - `status()` merges `readJob()`, cached ~1 s so concurrent polls do not read the file each time; the cache is invalidated by `start()` and by every job-file write the server itself makes.
- `create-core.ts`: single owner after foundation (core agent).

### cli (`packages/cli/src/update` and `service`)
- **Availability check** (one function, `latest-version.ts`, used by core's `latestVersion` and by `tau update`, run-update.ts:125 `latestOrError`):
  1. Resolve the registry like npm: `npm config get @pablopunk:registry`, falling back to `registry` (npm binary is `npmOf(execPath)`, latest-version.ts:8). npm prints the literal `undefined` (exit 0) when the scope is unset, so `undefined` and an empty string both count as unset. Strip a trailing slash before joining paths. Read `dist-tags.latest`.
  2. `GET <registry>/@pablopunk%2ftau/<v>` must be 200 (the version document `npm i` needs).
  3. `HEAD` the document's `dist.tarball`: 200 required.
  4. Anything else (404, ETARGET, 401/403/407 from auth or a proxy, timeout, bad JSON) throws; `update-service.ts:51` keeps the previous good `latest`. Tests: a runner returning `undefined` for the scoped key falls back to `registry`; trailing slash handled; 404 doc after tag, tarball 404, timeout; each leaves a previous `latest` intact. Known limit: behind a corporate proxy or with registry auth the check keeps failing, so **no button shows** (the user can still run `tau update`). `TAU_FAKE_LATEST` (latest-source.ts:10) bypasses all of this, so e2e does not cover it (see tests).
- `updater.ts` (new): `plan(target)` maps `installMethodOf` (install-method.ts:50-73) plus the cached backend gate (below) to `install`; `spawn` below; job file.
- **Spawn**, extending `Runner.spawnDetached` (service/runner.ts:33) with a `logFile` option (opens `<home>/update.log` for stdout and stderr instead of `stdio: "ignore"`); no second spawn path. `Runner.run` (service/runner.ts:28-37) has no env option and `systemd-run` must see `TAU_UPDATE_JOB` in its own environment, so `run` also gets an optional `env` (default: `process.env`); the systemd path calls `runner.run("systemd-run", args, { env })`. Env is `{ ...process.env }` minus `TAU_THREAD_ID` (the runner's default today is `options.env ?? process.env`, `:38`, and `run` uses the ambient env; the updater passes the filtered copy, never a replacement).
- **Where the child runs** (it must outlive `systemctl --user restart` / `launchctl kickstart -k`). Backend kind is `ServiceBackend.kind` (backend.ts:22). Which restart path `tau restart` takes: `restart.ts:11-12` calls `manager.restart()`, which does `native.reload(spec)` (bootout + bootstrap, launchd.ts:47) when the service definition changed (e.g. PATH re-copied) and `native.restart(spec)` (`kickstart -k`, launchd.ts:56) otherwise (manager.ts:111-116). The updater's restart step goes through the same `tau restart`, so **both launchd paths must be verified**.
  - **systemd** (`hasUserSystemd`, systemd.ts:11): the child is started with exactly
    `systemd-run --user --collect --quiet --unit=tau-update-<epoch> --working-directory=<home> --setenv=PATH=<spec.path> --setenv=HOME=<osHome> --setenv=TAU_HOME=<home> --setenv=TAU_UPDATE_JOB -p StandardOutput=file:<home>/update.log -p StandardError=inherit -- <node> <entry> update --target <v> --yes --force --home <home>`.
    `spec.path` is the captured service PATH (`buildSpec`, service/spec.ts:24-34). A transient unit gets the manager's environment, not ours, and logs to the journal by default, hence the explicit `--setenv` and output properties. `--setenv=TAU_UPDATE_JOB` has no value: systemd-run copies it from its own environment, which the server sets on spawn, so the nonce is not on argv. `file:` (systemd 236+; `append:` needs 240 and RHEL 8 ships 239) truncates the log per run, which we want. `--collect` also needs 236: below that (`systemctl --version`) `install.mode` is `manual` on this backend. It has its own cgroup (the generated unit has no `KillMode`, render.ts:37-50, so a plain child would die with the service). A unit test asserts this exact argv. `systemd-run` exiting 0 only means the unit started; the update result is read from the job file, never from that exit code. If `systemd-run` cannot start the unit the job is `failed` with its stderr; no silent fallback.
  - **detached backend** (`kind: "detached"`): plain `spawnDetached` with `detached: true`; no supervisor kills it.
  - **launchd, decided**: default is a Node `detached: true` spawn (`setsid`: own session and process group; `renderPlist` sets no `AbandonProcessGroup`, render.ts:6-30). The macOS owner's first task is a real verification of `kickstart -k` and of `bootout`/`bootstrap` with a hashed scratch label (names.ts:19-24; never `dev.tau.server`). **Fallback, used only if that verification fails**: `launchctl submit -l tau-update-<epoch> -o <home>/update.log -e <home>/update.log -- /usr/bin/env PATH=<spec.path> TAU_UPDATE_JOB=<nonce> <node> <entry> update --target <v> --yes --force --home <home>`, then `launchctl remove tau-update-<epoch>` when the job ends (the child removes its own label as its last step; the server removes stale `tau-update-*` labels on start). The nonce is on argv here and visible in `ps` (launchctl submit has no env option); acceptable because it is only a guard rail. An argv unit test covers both the submit and the remove commands.
- **Job file** `<home>/update.json`, written atomically (temp file + rename), `0600`: `{ state, target, from, nonce, pid, startedAt, error }`. The server writes `installing` with a fresh random `nonce` and `pid: null` before spawning and passes the nonce to the child in the environment (`TAU_UPDATE_JOB`; on the detached and systemd paths it is not on argv, on the launchd submit fallback it is). Under a transient systemd unit the child's parent is `systemd --user`, so the nonce only matters on the detached and launchd paths. The child writes its own `process.pid` at startup and rewrites its state on every step (`installing`, `restarting`, then `idle` or `failed`), so a premature `failed` (from the grace or the 10-minute rule below) heals itself. ENOSPC or any write error → `failed` (best effort in memory). Corrupt or unreadable file → `idle`. Every server-side write invalidates the 1 s read cache.
- **Staleness** (on server start and on each `readJob`):
  - `job.target === current` → write `idle`.
  - `installing`/`restarting`, `target !== current`, pid dead (`process.kill(pid, 0)`) → `failed` at once, but only after the child has written its own pid, or once 30 s have passed since `startedAt` with `pid` still null (spawn failed). "The update stopped before it finished."
  - pid alive but older than 10 min → `failed` (heals if the child later writes a new step).
  - `failed` and `current !== job.from` → `idle` (someone updated by hand).
  - The last failed log stays until the next `start` truncates it.
- **Restart guard.** `restart-step.ts:14` (`TAU_THREAD_ID` refusal) stays unconditional. The `isInsideServer` ancestry check (`:13-20`) is skipped only when `TAU_UPDATE_JOB` matches the `nonce` in `update.json` **and** `process.pid` equals the pid the child recorded. The nonce is a guard rail against accidents, not a security boundary: an agent running as the same user can read `update.json` (`0600` does not stop the same user). What stops an agent's bash is the unconditional `TAU_THREAD_ID` refusal; only the child the updater spawns itself has that variable stripped.
- **Child flags** (`update-flags.ts`): `--target <v>` installs exactly that version (not a fresh `latest`) and is validated with `isPlainVersion` (protocol/src/versions.ts:4) before anything runs, `--yes`, `--force`. `--force` today only skips the running-work refusal when `running === "service"` (run-update.ts:138); the server uses the same shared `runningWorkOf` for its own `update_busy` check, so server and child agree. Test: the child never prompts (`deps.isTty` false, `--yes` set → no `NON_TTY_NEEDS_YES` path, run-update.ts:149-152).
- Text: CLI strings stay in `cli/src/update/update-text.ts`; the web file is named `sidebar/update-copy.ts` (no two `update-text.ts`).
- `install-method.ts`: return `manualCommand` for every refusal that has one. When an npm or pnpm install is forced to `manual` because its backend is unverified (section 5), the command is `npm i -g @pablopunk/tau@latest && tau restart` (pnpm: `pnpm add -g @pablopunk/tau@latest && tau restart`). npx/dlx (`:41-43`) → `npm i -g @pablopunk/tau@latest && tau restart` (decision 2); bun/volta (`:39-40`) → their commands, as `manualCommand` (today only inside `reason`); dev checkout (`:44-45`) → none.
- `run.ts:74`: build the updater, pass `autoStart: true`. Test hooks `TAU_FAKE_LATEST` (existing) and `TAU_FAKE_UPDATE` (child replaced by a script) are honoured only when `TAU_HOME` is under `os.tmpdir()` (unit-tested).
- **Log tail**: last 4 KB of `update.log`, ANSI stripped, only returned to owners.
- **Service gap (found on 0.3.0):** `tau update` and `tau restart` start a stopped or background tau without installing the service, so a node updated that way does not start after a reboot (`status`: "background, not a service"). Bare `tau` already installs when missing (`lifecycle/bare.ts`, `runBareWith`). Fix: extract the install-or-repair step from `runBareWith` into one function and call it from `runRestartWith` (`lifecycle/restart.ts`) and from the update restart step (`update/restart-step.ts`) before restarting, unless the server runs in the foreground (`ForegroundHolderError`) or the entry is temporary (npx: keep today's hint). Same warnings as bare `tau`. On macOS, `launchctl bootstrap` can fail while a background (non-service) tau holds the port: stop the background instance first, then bootstrap, then start (seen on the real Mac: "bootstrap failed: the job could not be loaded"). Tests: restart and update on a home with no service install it; foreground refuses; npx entry keeps the hint; a background instance is stopped before bootstrap.

### server (`packages/server/src`)
- `rest/define-route.ts`: add an optional `ownerOnly` flag consumed as a `preHandler`; it rejects unless `request.deviceId === OWNER_DEVICE_ID` (`security/guard.ts:25`) and also rejects `""` (the pre-auth value, fastify-augmentation.ts:3) with `forbidden`. Device cookies and node-link requests carry a device id or node identity (guard.ts:45,64,117-120), so they get 403. Register `startUpdate` with it.
- Only `startUpdate` is owner-only; `getUpdateStatus` / `refreshUpdateStatus` stay readable to every authenticated caller but redact `install.command` and `job.logTail` for non-owners and set `canUpdate: false`.
- Hub proxying: `nodes/path-filter.ts:11-19` already denies first segment `update` (`DENIED_FIRST_SEGMENTS`), so `/api/update/start` and `/api/update` never cross a link. Add a test in `path-filter.test.ts` for `/api/update/start` and `/api/update/refresh`.
- Test that enumerates owner-only routes (a list in the test, fed from the `routes` table) and asserts 403 for a paired-device cookie and a node-link request, 202 for the owner.
- `error-handler.ts`: map the new codes (foundation).

### web (`packages/web/src`)
- `components/ui` already has `alert-dialog`, `confirm-dialog`, `copy-button`, `tooltip`, `sonner`, `spinner`, `code-display`, `button`. There is no `progress`, so none is used. Feature components `sidebar/UpdateButton.tsx` and `sidebar/UpdateDialog.tsx` compose those pieces; no new ui primitive is needed, and none is styled one-off.
- `AppSidebar.tsx:123-128`: footer `flex items-center justify-between gap-2`; Settings left, `UpdateButton` right. Verify at 420 px with agent-browser and a long version (e.g. `0.10.12`); below `sm` fall back to icon-only with `aria-label` if it wraps.
- `lib/queries.ts`: `useStartUpdate`; poll 2 s with `retry: false` while `job.state` is `installing`/`restarting`, 60 s otherwise (5 s while `latest` is unknown, as now). Network errors during a job are ignored.
- Reload rule: on first load the page stores `status.current` in memory (`loadedVersion`). It reloads once when a status arrives whose `current !== loadedVersion`. After the reload the fresh page records the new `current` as its baseline, so a page that loads with `job.state === "idle"` and `job.target === current` never reloads (no loop, whether or not `idle` keeps `job.target`). The rule does not depend on `job.target` or `job.state`, so it also covers other tabs, non-owner pages and a manual CLI update. `job.target` only picks the toast text: before `location.reload()` the page writes `sessionStorage["tau.updated"] = job.target ?? status.current` if this tab started the update; on load that tab shows the toast and clears the key (sessionStorage is per tab, so other tabs reload silently).
- Hide timeout: "tau did not come back. Run `tau status`." fires 90 s after `job.state` first became `restarting`, not after the click.
- Fake client: `updates.start` walks installing → restarting → done; `?fake=update-fail` shows the failure path.

## 3. Install-method matrix

| Install | Detected by | `install.mode` | Button / click |
|---|---|---|---|
| npm global | install-method.ts:28,65 | run | confirm → run |
| pnpm global | `:58` | run | confirm → run |
| mise/asdf npm | npm layout, hint `:71` | run | run; success text adds `mise reshim` hint |
| npx / dlx cache | `:41` | manual | `npm i -g @pablopunk/tau@latest && tau restart`, nothing runs |
| Windows | `:53` | manual | command (`npm i -g ...`) |
| bun / volta | `:39-40` | manual | their command |
| Dev checkout | `:44` | none | hidden |
| Foreground (not a service) | `gatherStatus().running` | run | installs; no restart; copy says so |

## 4. Failure modes

| Failure | Handling |
|---|---|
| Registry down / version doc or tarball 404 | check throws; previous `latest` kept; tick retries in 15 min |
| Running work, not forced | `update_busy`; dialog warns and sends `force: true` only after the user confirms |
| `target` not equal to `latest` | `update_unsupported`; the web refetches and re-asks |
| Double click / two tabs | `start` is idempotent while a job is active |
| Install fails | child exits non-zero → `failed`, log tail (4 KB, no ANSI), old server keeps running |
| Child killed with the service | systemd: transient unit; launchd: process group / `launchctl submit` fallback; verified in section 5 |
| Server dies mid-update | stale rules above (pid dead → `failed`; target equals current → `idle`) |
| Disk full / corrupt job file | write error → `failed`; corrupt → `idle` |
| Non-owner | 403 `forbidden`, redacted status |
| Peer mismatch after update | `update-required` on the peer until updated there |

## 5. Test plan

- **Verification = exit criterion** (human or non-low-effort agent): (1) Linux: ubuntu CI job (`.github/workflows/ci.yml:17`; a container with user systemd) or a VM; install a prerelease from a local registry into a scratch prefix and scratch osHome, run the button flow, assert the transient `tau-update-*` unit survives `systemctl --user restart`, logs to `update.log`, and the new version is up. (2) macOS: scratch osHome and a hashed label, **both** `kickstart -k` and `bootout`/`bootstrap` (force the second by changing PATH so `manager.restart` reloads, manager.ts:116); if the child dies, switch to the `launchctl submit` fallback and repeat. **Until a backend's run passes, `install.mode` is `"manual"` on that backend** (the command to copy). Only the systemd and launchd backends are gated; the detached backend and foreground runs are `run` from the start (no supervisor, nothing to survive), so the feature can merge without ever restarting a user's service unverified. The flag is a constant in `updater.ts` per backend kind, flipped in the commit that records the passing run.
- **Unit (cli)**: availability function (above cases, previous value kept); `updater.plan` over the matrix incl. `manualCommand` for npx/bun/volta; spawn via an injected `Runner` asserts `systemd-run` args on systemd, plain detached otherwise, env filtered and not replaced, `logFile` set; job-file atomic write, ENOSPC, corrupt, stale rules; nonce guard (valid nonce skips ancestry check; `TAU_THREAD_ID` still refuses; wrong nonce refuses); `--target` installs exactly that; child never prompts.
- **Unit (core)**: fake timers; `autoStart` false makes zero `latestVersion` calls; 15 min + jitter; `start` refusals; job merge; 1 s read cache; `stop()`.
- **Unit (server)**: `forbidden` for `""`, device cookie, node link; owner 202; redaction; body schema rejects extra and missing fields; `every-route.test.ts`; `path-filter.test.ts` denies `/api/update/*`; error code tests.
- **Contract (testkit)**: fake `updates.start`, job states, `canUpdate`.
- **Web**: one test per matrix row (npm, pnpm, mise, npx, Windows, bun/volta, dev checkout, foreground) asserting visibility and what click opens (npx: button shown, command dialog, no start call); non-owner (`canUpdate: false`) never shows it in any state but still reloads when `current` changes; a fresh page with `idle` and `target === current` does not reload; `failed` clears when `current` changes; `Updating…` disabled; `failed` row shows even when not behind, Retry only for `mode: run`; dialog copy with and without running work and for foreground; reload only when `current` changes from the page's baseline; sessionStorage toast; two-tab case; poll rules.
- **E2E (built CLI, Playwright)**: scratch `TAU_HOME`, scratch osHome, random free port, **detached backend** (no real launchd/systemd unit, ever), `TAU_FAKE_LATEST` and `TAU_FAKE_UPDATE`. Asserts: button → dialog → progress → reload → toast; failure with log tail; 403 for a paired-device cookie against the real built server. The availability check is **not** covered here (the fake bypasses it); it is covered by the unit tests and verification step 1.

## 6. Work split

1. **Foundation** (one agent): protocol schemas, error codes, `error-codes.test.ts`, `error-handler.ts`, route, `core.ts` interface, moved `lineageOf`/`runningWorkOf`, testkit fake and contract, stubs in core and cli, `define-route.ts` `ownerOnly` option, the protocol hash change. Done when check, test, build pass.
2. **Owners** (no overlaps): core (`core/src/updates/**`, `create-core.ts`); cli (`cli/src/update/**`, `cli/src/lifecycle/**` for the service gap, `service/runner.ts`, `run.ts`, restart step; **the systemd piece needs a human or non-low-effort agent with Linux; the launchd piece a human on macOS, whose first task is the real `kickstart -k` / `bootout` verification**, since the default Sonnet/low-effort agents cannot verify it); server (`server/src/rest/**` registration, `security/**`, tests); web (`web/src/sidebar/**`, `lib/queries.ts`, fake client).
3. **Integrator**: applies notes, merges, runs check and test per merge; then e2e. The systemd path merges to `run` only after the Linux run passes; the launchd path only after the `kickstart -k` and `bootout` runs pass (section 5). Until then those backends stay `manual`.

## 7. Open questions

None. macOS default is decided (detached spawn, `launchctl submit` only if verification fails). If a backend's verification has not passed by the release, v1 ships `manual` on that backend (command to copy); the button still shows there.

## Review history

- Round 1 added: `forbidden`/`update_busy`/`update_unsupported` codes, the protocol-hash/peer-mismatch analysis, transient systemd unit, job file with nonce, stale-job rules, shared availability check, `ownerOnly` route option.
- Round 2 split `canUpdate` (owner) from install mode and job state, fixed the systemd env/log argv, defined the launchd default and fallback, added verification as an exit criterion.
- Round 3 fixed the scoped-registry `undefined` case, systemd 236 compatibility, nonce handling, the 30 s pid grace, non-owner behaviour, and the manual commands.

## Foundation hand-off

**Frozen (do not change without the integrator; changing a route or schema needs `mise exec -- pnpm --filter @tau/protocol bump-protocol`):**
- protocol: `UpdateStatus` = `current, latest, checkedAt, behind, canUpdate, install{mode,command,reason}, job{state,target,error,logTail}` (`from` is NOT in it); `UpdateStartBodySchema` (`additionalProperties: false`); route `startUpdate` POST `/api/update/start`, 202 (`RouteDef.status` now allows 202; excluded from the CLI command table); `Core.updates.start`; `UpdaterPort` (`plan` sync, `spawn`, `readJob`), `CreateCoreOptions.autoStartUpdates` / `.updater`; error codes `forbidden` 403, `update_busy` 409, `update_unsupported` 422 (`error-handler.ts` maps through `ERROR_STATUS`); `lineageOf`, `runningWorkOf`, `hasRunningWork`, `RunningWork` in `protocol/src/running-work.ts`; hash bumped once.
- server: `defineRoute(app, route, handler, { ownerOnly })` (preHandler; rejects everything but `OWNER_DEVICE_ID`, including `""`); `startUpdate` registered with it; `rest/owner-only.test.ts`.
- web: `api.updates.start`, fake transport handler `startUpdate`. testkit: `createFakeUpdates` (installing → restarting → done via `updatesControl.advance()`; options `install`, `canUpdate`, `failUpdate`, `busy` via `createFakeCore({ updates })`); contract cases tagged `[updates-job]`, pending on the real core (`core/src/contract.test.ts`); remove the tag when core lands.

**Stubs**
- core `update-service.ts`: `start` throws `update_unsupported`; `snapshot()` returns `canUpdate: true` (the owner's view), `install: NO_INSTALL`, `job: IDLE_JOB`; `autoStart` works (check at creation) but the timer is still the 6 h `setInterval`.
- cli `update/updater.ts`: `createUpdater` throws; `BACKEND_VERIFIED` gate constants; `JobFile` type. `lifecycle/install-or-repair.ts`: `installOrRepairService` throws.
- `running-work.ts` and `own-thread.ts` already re-export from protocol (done, not stubs).

**Owners (no file has two owners)**
- **core**: `core/src/updates/**`, `core/src/create-core.ts`, `core/src/nodes` peer-mismatch test, `core/src/contract.test.ts`. Fill: 15 min jittered `setTimeout`, `start` rules, job merge with 1 s cache, `canUpdate`/`install`/`job` from `updater`. Make pass: core unit tests of section 5, `[updates-job]` contract cases (drop the `pending` tag).
- **cli**: `cli/src/update/**` (incl. `updater.ts`, `latest-version.ts`, `install-method.ts`, `update-flags.ts`, `restart-step.ts`), `cli/src/lifecycle/**`, `cli/src/service/runner.ts` (`logFile`, `run` env), `cli/src/run.ts` (build updater, `autoStartUpdates: true`). Fill: both stubs, availability check, spawn argv per backend, job file, staleness, restart guard, service gap. Tests: section 5 cli list. Systemd piece needs Linux, launchd piece a human on macOS.
- **server**: `server/src/rest/register-routes.ts` (non-owner redaction of `install.command` and `job.logTail`, `canUpdate: false` in the GET/refresh handlers and the `startUpdate` response), `server/src/security/**`, `server/src/nodes/path-filter.test.ts`, new owner-only enumerating test (paired device 403, node link 403, owner 202). `define-route.ts` and `error-handler.ts` are frozen.
- **web**: `web/src/sidebar/**` (`UpdateButton`, `UpdateDialog`, `update-copy.ts`, `AppSidebar.tsx`), `web/src/lib/queries.ts`, `web/src/lib/updates.ts`, `web/src/lib/transport/fake.ts` for `?fake=update-fail` only, web tests. Reload rule: `loadedVersion` lives in memory only, never `sessionStorage` (only the `tau.updated` toast key uses it).

**Reviewer notes to honour**
- `updater.ts`: keep a comment next to the per-backend gate constant saying it flips only in the commit that records the passing run (present in the stub).
- Argv unit test asserts `TAU_UPDATE_JOB` is in the spawn env and absent from argv (systemd and detached paths).

**Integrator notes**
- Core returns the owner's view of `canUpdate`; only the server may downgrade it. Do not let the web trust `canUpdate` from a fake without `canUpdate: false` tests.
- Real client validates responses against the schema, so any test fixture of `UpdateStatus` needs the three new fields (`NodesSection.test.tsx` was updated).
- `server/src/nodes/link-requests.test.ts` "42 MB request body" failed once under full-suite load (empty body hashed), passes alone and in reruns; unrelated to this change.

## Integration

**Applied**
- CLI notes: all read; `INTEGRATOR-NOTES-UPDATE.md` deleted. `TAU_FAKE_LATEST` / `TAU_FAKE_UPDATE` need a home under `os.tmpdir()`; new `TAU_FAKE_VERSION` (same rule, `update/fake-hooks.ts` `versionOf`, used by `serve.ts`) lets a fake update change the version the server reports.
- Stale rules: already applied in the CLI updater's `readJob` (`settled()` in `update/updater.ts`: dead pid after the child's pid or 30 s, `from` change clears `failed`, target = current gives `idle`), with tests in `updater.test.ts` ("job staleness").
- `start` and the caller's lineage: left as is. `UpdateStartBody` has no thread id and the plan does not require one; a button click comes from the browser, not from a thread, so `update_busy` counts every running thread and the dialog's `force: true` is the user's answer. A thread that runs `tau update` itself is refused by the unconditional `TAU_THREAD_ID` guard anyway.
- Foreground run: `UpdaterDeps.foreground` (real: no `--service` in argv) sets `install.reason` to "tau was not started as a service, so it will not restart. Restart it yourself afterwards." in `run` mode; tested in `updater.test.ts`. The web dialog already shows `reason` in place of the restart sentence.
- `useUpdateStatus` polling every 60 s with Settings sharing the hook: fine. It is one query key (one request per interval), the job poll drops to 2 s only while a job runs, and the Settings refresh button forces a check.
- Server: the node-link bearer is rejected with 4xx before `ownerOnly`; the test stays.
- Update restart step installing a missing service for a background tau: tested with injected runners (`run-update.test.ts`).
- E2E `e2e/tests/update-button.spec.ts` (+ `e2e/update-support.ts`): a copy of the built CLI in an npm-global layout (and an `_npx` layout), scratch home under tmpdir, random port, `tau start` (detached backend only). Covers: paired device cookie gets 403 on `POST /api/update/start` and `canUpdate: false`; owner sees Update; confirm dialog and Cancel; fake update installing, restarting, done, reload, toast "tau updated to 9.9.9"; npx shows the copy command and starts nothing. The failure-with-log-tail path is covered by web and cli unit tests only.
- README and PLAN.md describe the button and `tau update`.

**Still unverified**
- The real systemd (`systemd-run` transient unit surviving `systemctl --user restart`) and launchd (`kickstart -k` and `bootout`/`bootstrap`) restart-survival runs. `BACKEND_VERIFIED` stays `{ systemd: false, launchd: false, detached: true }`, so those services show the copy command. `LAUNCHD_USE_SUBMIT` stays false; stale `tau-update-*` label cleanup is not implemented.
- The real registry availability check (`TAU_FAKE_LATEST` bypasses it); a real `npm i -g`.
