# Integrator notes (Owner H)

- Nothing needed outside `packages/cli`. `pnpm install --frozen-lockfile` was needed in the fresh worktree.
- `nodes list` now calls `getNodeDirectory` (not `listNodes`), so it needs the real directory from E; the table row still says `listNodes`.
- `nodes remove`: `--confirm <name|id>` replaces `--yes`; a name is resolved to an id through the directory.
- `access rotate` asks on a TTY (`CommandEnv.confirm`); without a TTY it needs `--yes`.
