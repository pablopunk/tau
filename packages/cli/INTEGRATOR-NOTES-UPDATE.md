# Integrator notes (cli owner, update button)

- `fetchLatestVersion(run, execPath, fetchImpl = fetch)` now uses `npm config get` plus HTTP; `tau update` shares it through `real-deps.ts`.
- `TAU_FAKE_LATEST` and `TAU_FAKE_UPDATE` are honoured only when the home (`TAU_HOME` / `--home`) is under `os.tmpdir()`. e2e must use a scratch home there. `TAU_FAKE_UPDATE` is a script run as `node <script> update --target V --yes --force --home H` with `TAU_UPDATE_JOB` in its env; it should write its pid and steps to `<home>/update.json` if it wants to look like the real child.
- `run.ts`: new optional `RunDependencies.createUpdater`; by default the real updater is built only when `cliEntry` is passed (`serve.ts` does), so unit tests of `run` never probe systemctl. `autoStartUpdates: true` always.
- `BACKEND_VERIFIED` unchanged (systemd, launchd false: manual). `LAUNCHD_USE_SUBMIT = false` in `update/spawn-child.ts` is the launchd submit fallback switch; the stale `tau-update-*` label cleanup on server start is NOT implemented (only needed if the fallback is switched on).
- Not run (no Linux/macOS verification here): the real systemd-run and launchd restart-survival runs of section 5.
- Not tested: `restartInNewBinary` installing a missing service for a *background* tau; the shared `installOrRepairService` is tested directly and through `tau restart`.
