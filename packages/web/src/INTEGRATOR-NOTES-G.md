# Integrator notes (Owner G)

- No change needed in `app/App.tsx`.
- `lib/transport/fake.ts`: the fake `getNodeDirectory`, `listExpulsions` and `removeNode` handlers are used as they are. For a visual pass of "via", skew, the cap warning and a pending expulsion, the fake group could return a routed node with `skewMs` beyond 120000 and one expulsion with a `pending` entry (optional).
- Existing tests that stub `/api/nodes` now also serve `/api/nodes/directory` through `src/test/directory.ts` (`asDirectory`). Any other test that mounts `useNodes()` needs the same.
- `useNodes()` now returns `DirectoryNode[]` (a superset of `Node`) from `getNodeDirectory`; `Change{resource:"nodes"}` invalidates `["nodes"]`, which covers the directory and expulsions keys.
- Routed-node offline cache: the browser reads `readSummaryCache(nodeId)` when `getNodeSummary` fails (routed nodes have no hub summary).
