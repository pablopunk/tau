# Linux verification notes

## For the Mac agent (files I do not own)
No bug found in `processes/**` outside `governor/{wrap-command,resource-support}.ts`. Observations, not defects:
- `governor-text.ts` `CGROUP_NOTE` is now unused (resource-support returns `note: null` when the probe passes; the web line
  "Priority only ranks against commands in the same group as tau." is shown when `sameCgroupOnly` is true). Delete it if you like.
- Plan text says the polled watcher's first signal comes after 4 s or more. Measured on Linux: a single sweep above 1.5x the limit
  kills at the first sweep (2.16 s after start). Plan wording only.
- A daemon that double-forks and reparents before the first sweep survives a polled kill (documented in the plan).
- Wrapper argv changed for Linux background: `sh -c <script> _ <chrt> <nice> <sh> <shell> -c cmd` (was `_ <shell> -c cmd`), so any
  test asserting the old argv must follow `BACKGROUND_CHRT` exported from `wrap-command.ts`.
