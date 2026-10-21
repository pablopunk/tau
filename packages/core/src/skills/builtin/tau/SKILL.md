---
name: tau
description: Control the tau app from bash with the `tau` CLI. Use to start or check threads in other projects, merge worktrees, open pull requests, or change settings.
---

# tau

tau runs your threads. The `tau` command is on your PATH and talks to the same app. `TAU_THREAD_ID` is your own thread. Output is JSON. Start with `tau --help`, or `tau <noun> --help`.

For your own subagents, use the `agent` tools, not this CLI.

## Work in another project

```sh
tau projects list
tau threads start --project <projectId> "Fix the flaky test" --wait
tau threads read <threadId> --last 5
tau threads send <threadId> "Also update the README" --wait
```

`--wait` blocks until the thread is idle and prints the last answer. Do not poll. `--timeout <s>` changes the 600 s limit (exit 3 on timeout, exit 1 when the thread ends in error).

## Check other threads

```sh
tau threads list
tau threads wait <threadId>
tau threads abort <threadId>
```

## Merge or open a pull request

```sh
tau workspaces get <threadId>
tau workspaces merge <threadId>
tau workspaces pull-request <threadId>
```

## Settings, only when the user asks

```sh
tau settings get
tau settings set-default-model openrouter/anthropic/claude-sonnet-5-5
tau settings set-default-thinking none
```

## Update tau

`tau update --check` says whether a newer release exists; `tau update` installs it and restarts tau. Only do it when the user asks.

## Ports

- `tau serve` defaults to `:4317`: pass `--port` explicitly when another session may hold it.
- Web dev proxies `/api` to `TAU_API` (default `http://127.0.0.1:4317`): always pass it explicitly, the default may be another session's server.

## Rules

- Destructive commands (`threads delete`, `projects remove`, `workspaces remove`) need `--yes`. Ask the user first.
- You cannot delete or archive your own thread or its parents.
- A usage error exits 2. An app error prints `code: message` and exits 1.
