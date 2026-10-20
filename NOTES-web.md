# Web notes (Phase 2)
- `AgentSection.test.tsx` mocks `api.settings` without `resourceSupport`; `ResourcesGroup` then shows "This node needs an update" (query errors, no crash). Unverified, not run.
- Existing tests that mount the Agent section with the real fake core are untouched.
- Heavy command times use `RelativeTime` (30 s refresh); activity refresh relies on `Change{resources}` invalidation.
- Typing a number commits on blur/Enter; out-of-range input is discarded.
