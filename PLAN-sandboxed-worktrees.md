# Sandboxed worktrees (plan) — v3 (DRAFT, review rounds 1-2 folded in)

## Problem

A subagent thread can write anywhere: `edit` with an absolute path into the main checkout and
`cd /Users/pablopunk/src/tau && git add && git commit` both worked, no guard stopped either
(conversation 5, entries 74920/74922). Tool-level path checks are bypassable via `bash`
(`python`, `/bin/sh`, `git -C`). Enforcement must be OS-level.

## Goal

Every process a thread spawns may READ anywhere but may WRITE only inside its own worktree
(plus its git admin dir, see below), while the existing per-scope CPU priority and memory cap
keep applying unchanged. Near-zero overhead, per-thread setup «1 s, macOS + Linux.

## Review round 1 verdict (all folded below)

- BLOCKER R1-1: `edit`/`write` are in-process Pi tools (`env.writeFile`), never spawn a shell:
  the spawn wrapper cannot cover them. Fix: Layer 2 below (trusted path check in our code +
  MCP scoping). The "weak patch" is a *required layer*, not the whole fix.
- BLOCKER R1-2: denying all of `<main>/.git/refs` breaks normal worktree commits (the branch ref
  lives in shared `.git`). Fix: per-thread ref/reflog allowlist (below).
- MAJOR R1-3..R1-9 folded into §Trust root, §Removal race, §Linux service, §Lifecycle, §Setting,
  §Signal scope, §Merge exception.

## Non-goals

- No VMs, images, daemons (OrbStack/nono/gVisor rejected: GBs + minutes per thread).
- No network egress policy in v1 (best-effort later; Secret redaction likewise).
- No per-thread UNIX users (breaks caches/ssh).
- The sanctioned merge flow still touches main by design; everything else is denied.

## Evidence (spike 75692, all PASS)

- macOS 48 GiB arm64: `sandbox-exec` present. Profile (deny file-write outside `$WT` incl. both
  `/tmp` and `/private/tmp` spellings, `/dev/null` allowed, reads open) denies outside writes,
  `taskpolicy -b` inside still drops pri 20→4, outside TERM still kills (sweep kill path intact).
  `(deny signal)` additionally blocks inside→outside kills without affecting the sweep.
  Caveat: setuid `/bin/ps` cannot exec under Seatbelt (observing priority must happen from outside).
- Linux Debian 13 (vibemachine, 4 GB): `bwrap` NOT installed; `unprivileged_userns_clone=1`.
  Substitute verified: transient `systemd-run --user` service with `ProtectSystem=strict` +
  `ProtectHome=read-only` + `ReadWritePaths=<worktree>` + `PrivateTmp=yes` confines writes,
  `Nice=` applies and composes with inner `nice`, outside TERM kills the unit, cgroup shows containment.
- systemd sandboxing directives do NOT compose with the MemoryMax *scope* (scopes can't take them);
  transient user *services* can. So sandboxing and the memory scope stay two nested wrappers.

## Design

Two layers, both enforced (defense in depth, each covering what the other cannot):

- **Layer 1 — spawned processes** (`bash`, `process_start`, `monitor`, `bang`, and anything
  reaching `spawnRunning`): OS sandbox as in v1 (Seatbelt profile / systemd unit / bwrap option).
- **Layer 2 — in-process tools** (`edit`, `write`, MCP servers, user-opened terminals): they never
  spawn, so Layer 1 cannot see them. Confinement happens in OUR code, which the agent cannot bypass:
  open the target with `O_NOFOLLOW` and re-validate the resolved path against the sandbox root
  AFTER opening (no check-then-write race; symlink swaps fail closed). MCP covers stdio AND HTTP
  servers: deny by default, per-server allowlist; anything unlisted is documented UNENFORCED in the
  UI, not silently trusted. User-opened terminals are out of scope in v1 (stated, not enforced).

### New module: `processes/sandbox/` (small files, mirrors `governor/`)

- `profile.ts` (macOS): generate the Seatbelt profile text per worktree root. Deny `file-write*`
  outside `(subpath <wt>)` (+ `/private` spelling when `/tmp`-prefixed), literal `/dev/null` allowed,
  `(deny signal)`, allow default (read/exec/stdio). No `network*` rule in v1.
- `unit.ts` (Linux): build the `systemd-run --user --pipe --wait` argv per worktree:
  `ProtectSystem=strict ProtectHome=read-only ReadWritePaths=<wt> <admin-dir> PrivateTmp=yes`,
  plus pass-through of the existing `Nice=`/scope wrapping (nesting: sandbox service outside,
  governor wrap inside). `bwrap` path kept as an option where installed
  (`--ro-bind / / --bind <wt> <wt>`, no `--unshare-pid`: outer PIDs must stay stable for the sweep).
- `git-scope.ts` (shared): the writable set for git. A linked worktree is a `.git` *file*
  (`gitdir: <main>/.git/worktrees/<name>`); objects/refs/config live in the main repo. Allow writes
  to the thread's own admin dir + `objects/` (append-only in practice; GC/deletion of shared data
  is an accepted residual risk, tested) + ONLY the thread's ref and reflog
  (`refs/heads/<branch>`, `logs/refs/heads/<branch>`, plus lockfiles); deny everything else in
  shared `.git` (`HEAD`, `config`, other refs), the main checkout, and other threads' `worktrees/*`.
  Positive test first (worktree commit succeeds), then negative (main-checkout commit denied).
  Measured (spike 77216; `fs_usage`/`dtruss` need root, `strace` absent — done by before/after
  snapshots in scratch repos instead): `status`/`log` write nothing; `add` writes the file +
  admin `index` + one shared blob; `commit` writes admin `index`/`logs/HEAD`/`COMMIT_EDITMSG` +
  shared objects + ONLY its own branch ref+reflog (`refs/heads/<branch>`,
  `logs/refs/heads/<branch>`); `fetch` writes admin `FETCH_HEAD` + shared `refs/remotes/*` +
  their reflogs + objects. So: writable = whole checkout + whole own admin dir + shared
  `objects/` + own branch ref/reflog + `refs/remotes/*` (+ tags if used). Denied = shared `HEAD`,
  `config`, `hooks/`, `info/`, other branches' refs+reflogs, top-level `index`/`logs/HEAD`,
  `packed-refs` (read-only is fine). Locks are transient, none left behind.
- `wrap-command.ts` analogue: `sandboxPrefix(worktree, support)` returning argv or `[]` when
  sandboxing is off/unsupported. Precedence in `process-service` spawn: sandbox outside, governor
  (priority+memory) inside — verified composition.

### Trust root (R1-3)

`StartProcessRequest` carries only `conversationId` + `cwd`; `workspace.path` is a project
subpath, not the root, and removed worktrees keep `mode: "worktree"` with a rewritten path.
So: resolve a canonical sandbox root from trusted thread metadata (project + workspace +
worktree name → root) for EVERY spawn and EVERY Layer-2 write; handle checkout/non-Git/removed
worktrees explicitly; fail closed (deny) when unresolvable — never silently substitute `cwd`.
Children inherit the parent's root (`subagent-runtime` already propagates the workspace).

### Integration points (`process-service.ts`)

- All four spawn paths (`bash` runForeground, `process_start`, `monitor`, `bang`) go through one
  `spawnRunning` call site: apply the sandbox prefix there, keyed by the resolved root.
- Main-checkout threads: sandbox to the main checkout (still blocks writes elsewhere, e.g. `$HOME`).
- Merge flow: the ONLY sanctioned writer to main, enforced at the trusted merge API
  (`merge_agent` must check the caller's thread kind, not just the target). Actor list: (1) the
  merge flow acting for a finished thread; (2) a MAIN-checkout thread editing files INSIDE the
  main checkout (the user's own context — narrowed: main threads cannot write OUTSIDE the
  checkout, and no subagent/worktree thread writes main).
- Removal race (R1-4): `WorkspaceService.remove()` must consult `ProcessService.hasRunning()`
  (background jobs outlive the model run): refuse removal while jobs run, or stop and await them.
  Test removal during a background process.
- Linux service (R1-5): the unit argv must carry `--working-directory` + a deliberate env allowlist
  (spawn applies cwd/env to the client, not the service). Cache/temp/SSH policy: home caches stay
  readable; `PrivateTmp` hides host `/tmp` SSH sockets and first-use `known_hosts` writes — DECIDED:
  `PNPM_STORE_DIR`, `CARGO_TARGET_DIR`, `MISE_DATA_DIR` redirect into `<worktree>/.tau-caches/`,
  the host SSH agent socket bind-mounts read-only, `GIT_SSH_COMMAND` gets
  `-o UserKnownHostsFile=<worktree>/.tau-caches/known_hosts`. Test `pnpm install`, `mise`,
  SSH-agent socket use, first connection (not just SSH reads).
  Escape all interpolated roots for Seatbelt/systemd syntax; test paths with spaces/quotes/backslashes.
- Lifecycle (R1-6): the unit is manager-owned, tau tracks PID/groups. Persist a stable unit id per
  process, stop/kill the UNIT explicitly (not just the group), test every stop/restart/reaping path.
  Polled fallback: enumerate unit processes via `systemctl show <unit> -p MainPID` + the unit's
  `ControlGroup` cgroup-procs walk (the sweep must learn units, not just root-PID trees).
  Benchmark contention in the nested layout: `Nice=` in a service cgroup measured much weaker than
  in a scope — if it doesn't hold, the support query reports it and the UI says so.
- Signal scope (R1-8): blanket `(deny signal)` breaks children signaling children (shell `kill`,
  `timeout`, test runners). Target-scope the rule if Seatbelt allows; else drop it and accept
  inside→outside kills as residual risk. Test signaling a child + group kill from inside.
- Setting + capability (R1-7): a DISTINCT persisted per-node sandbox switch (never reuse the
  resource-control levels: security must stay on while caps stay off). Protocol/API plumbing +
  a capability result that tests the actual enforcement path (not `platform !== "other"`);
  backward-compatible defaults + migration. Default: ON for subagents and worktree threads, OFF
  for main checkout threads. The rollout "off by default" below is a TEMPORARY staging gate for
  the foundation branch only, removed before merge. Unsupported → explicit "unenforced" UI state,
  never silent.

### Tests

- Unit: profile/unit argv golden tests; git-scope allowlist tests; spawn argv order test
  (sandbox outside governor); unsupported-platform passthrough.
- Real-machine: macOS Seatbelt confinement test (write denied/allowed, pri 4, outside kill);
  Linux test gated on userns+bwrap-or-systemd (vibemachine).
- e2e: a thread attempting an outside write fails with the denial; governed commands still complete.
- Negative tests: `git -C <main> commit`, absolute-path edit, `python open(...,'w')` outside — all denied.

### Rollout

1. `fs_usage` capture spike → minimal git writable set.
2. Foundation: sandbox module + spawn integration, off by default, check/test/build green.
3. Real-machine verify (macOS + vibemachine) with caps ON (subagents Background, as today).
   VERIFIED 2026-10-22 (integrator, live): macOS Seatbelt confinement in unit tests (inside-allow,
   outside-deny, child signaling, no blanket `deny signal`); vibemachine systemd service with the exact
   Layer-1 flags confines writes (home/root denied, read-only fs) AND nests the memory scope
   (`MemoryMax=536870912`, ActiveState=active) — sandbox + caps compose on both platforms. `Nice=`
   composes with inner `nice` (spike 75692). No stray units left behind.
4. UI: one toggle/row in Agent settings (reuse patterns), default TBD.
5. Docs: this plan → done; VERIFY-style evidence notes.

## Risks

- `sandbox-exec` is deprecated: tripwire CI job asserting it works; Landlock/bwrap fallback design
  kept warm for Linux, no macOS fallback exists.
- Over-denying breaks legit tools (node/pnpm caches, ssh, mise shims): caches stay readable;
  writes redirect into the worktree (see pnpm-store/CARGO_TARGET_DIR precedent); verify suite must
  cover `pnpm install`, `git commit`, `ssh` reads.
- Worktree deletion/admin-dir lifecycle: sandbox paths must resolve per spawn, no caching across moves.
