# Layer-1 sandbox ENFORCEMENT — integrator notes

Owner: Layer-1 agent. Owned files (committed): `packages/core/src/processes/sandbox/**`,
`packages/core/src/processes/process-service.ts`, `packages/core/src/processes/process-sandbox.test.ts`.
Nothing outside these was touched; everything below needs another owner.

## Wire-up (required before enforcement does anything)

Staging gate is ON by design: `deps.sandbox` defaults to all-false, so every
spawn currently takes today's argv. To arm enforcement:

1. `create-core.ts`: pass the node's real `SandboxSettings` (`deps.sandbox`),
   plus `resolveSandboxRoot: (conversationId) => TrustInput` built from trusted
   thread metadata (project + workspace + worktree name → root, plus
   `adminDir`/`sharedGitDir`/`branch` when known so the shared-`.git` allowlist
   narrows to the thread's own ref). `nodeId` is already passed; the stable
   unit id derives from it (`tau-<nodehash>-<entryId>.service`).
2. All four spawn tools (`bash` runForeground, `process_start`, `monitor`,
   `bang`) must forward the resolved root as `StartProcessRequest.sandboxRoot`
   / `ForegroundRequest.sandboxRoot` (fields exist; `runForeground` forwards).
   Until then only `deps.resolveSandboxRoot` can supply roots.
3. Fail-closed contract: sandbox ON + unresolvable root / cwd outside root /
   no enforcement binary on the host rejects the spawn with `forbidden`. Never
   add a cwd fallback — `resolveSandboxRoot` takes no cwd by construction.

## Coordination with sibling agents (do not duplicate)

- `ResourceSupport` shape: another agent is mid-flight adding a required
  `sandbox` field to it (`resource-support.ts` + test, currently red and
  breaking `tsc` in `process-governor.test.ts`). The capability probe they need
  already exists: `probeSandboxSupport()` in
  `processes/sandbox/sandbox-support.ts` (tests the real path, never
  `platform !== "other"`). Suggest they consume it instead of growing a second
  probe, and fix the `process-governor.test.ts` type error their change
  introduced (zero tsc errors in Layer-1 files).
- Polled fallback: `listSandboxUnitPids(exec, unit, readCgroupPids)` in
  `sandbox/unit.ts` (MainPID + ControlGroup walk, tested with fake exec) is
  ready for the `ps-sweep` owner to call; the sweep must learn units, not just
  root-PID trees.
- Removal race (workspaces owner): `hasRunning()` already exists — consult it
  (or stop + await) in `WorkspaceService.remove()`.
- Merge flow (outside Layer-1): the ONLY sanctioned writer to main; enforce at
  the trusted merge API by caller thread kind.
- Layer-2 (in-process `edit`/`write`, MCP scoping) is a different agent and is
  NOT covered by this change — spawn-level only, by design.

## Decisions locked in this change

- NO blanket `(deny signal)` in the Seatbelt profile (§Signal scope,
  else-branch): children signaling children must work. Tested live
  (`confinement.test.ts`: `kill $p` + `wait` from inside succeeds).
  Inside→outside kills are the accepted residual risk.
- Linux primary path is the transient user *service* (`--pipe --wait
  --collect`), NOT a scope (scopes can't take sandboxing directives) and NOT
  `bwrap` by default (`preferBwrap` opts in where installed; no
  `--unshare-pid` so outer PIDs stay stable for the sweep).
- Service env rides `--setenv` (spawn cwd/env only reach the client, hence
  `--working-directory` + deliberate env allowlist on the unit). Cache
  redirects (`PNPM_STORE_DIR`, `CARGO_TARGET_DIR`, `MISE_DATA_DIR` →
  `<wt>/.tau-caches/`), SSH socket `BindReadOnlyPaths`, `GIT_SSH_COMMAND`
  `UserKnownHostsFile` redirect are encoded in `unit.ts`.
- Stable unit id is derived, not stored in the pid file (`ProcessRecord`
  shape untouched): restart recomputes `tau-<nodehash>-<id>.service` and stops
  it in `reapStaleAtStartup` (Linux only, best-effort).
- Measured gotcha (caught by the suite, not by review): macOS resolves
  `/var` → `/private/var`, so a profile built from the unresolved spelling
  denies INSIDE writes. `resolveSandboxRoot` always returns the realpath'd
  root; callers must use it verbatim.

## Verification state

- New tests: 59 passed, 1 skipped (Linux systemd live test — no user bus on
  this Mac; MUST run on vibemachine before merge). macOS Seatbelt verified
  live: inside-allow, outside-deny, child signaling, shell timeout.
- Positive worktree-commit test runs before the negative main-commit test in
  `git-scope.test.ts` (before/after snapshot classifies every touched shared
  path as allowlisted; main ref/reflog/checkout classify denied).
- Full `@tau/core` suite: 1471 passed; remaining failures reproduce WITHOUT
  this change (stashed run): 3× `process-governor.test.ts` power tests
  (environmental/timing on a loaded box) plus load-dependent flakes
  (`contract-basics` resources-support, `run-clone` group-kill,
  `resource-support` sandbox-probe — the last is the sibling's red WIP).
- `tsc --noEmit`: clean for all Layer-1 files; the one repo-wide error is the
  sibling's `ResourceSupport.sandbox` WIP (see above).
