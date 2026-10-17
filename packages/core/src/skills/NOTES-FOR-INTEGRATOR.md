# Notes for the integrator (agent B, composer-core)

* `packages/core/src/contract.test.ts`: `PENDING_TAGS` becomes `["[login]"]`. I applied this edit locally to prove `[files]` and `[skills]` pass; keep or re-apply it.
* `compactConversation` already matches the plan (no change needed).
* `discoverSkills(projectFolder, home = homedir())` is cached 30 s per (home, folder); `clearSkillsCache()` is exported for tests. No `create-core.ts` wiring is needed.
