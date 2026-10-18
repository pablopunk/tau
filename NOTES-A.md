# Notes from owner A

* `core/src/contract.test.ts` (not mine): removed the `claude-cli` pending tag and set `process.env.TAU_FAKE_CLAUDE_CLI = "1"` at module load.
* `detect/` and `models/` got extra files; `ClaudeCliDetectorDeps` gained optional `env` and `installedVersion`.
* `models.refresh()` does nothing unless the detector is `ready`. `getModels()` starts a refresh by itself the first time it runs while ready, and calls `onChange` when the list lands, so the web should refetch models on a `providers` change.
* `provider-service.ts`: the first `list`, `listModels` and `lists` await one `claudeCli.refresh()`; `acknowledgeClaudeCli` refreshes again so the models are loaded when it returns.
* `model-list.ts`: faux mode has no registered Claude CLI provider, so it takes the CLI models through a new `claudeCliModels` dep.
