/**
 * Files that may import the singleton `api` from `@/lib/api`: only the two modules that legitimately hold the hub's
 * own node api (`nodes/node-apis.ts`, `nodes/NodeRegistry.tsx`). Everything else uses `useApi()` inside
 * a node provider and `useNodeApi(id)` outside one (tests use `apiOfNode()`).
 * `lib/api-singleton.test.ts` fails when another file starts importing it.
 */
export const API_SINGLETON_BASELINE: readonly string[] = ["nodes/NodeRegistry.tsx", "nodes/node-apis.ts"];
