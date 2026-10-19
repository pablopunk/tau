/**
 * Files that may import the singleton `api` from `@/lib/api`: only the two modules that legitimately hold the hub's
 * own machine api (`machines/machine-apis.ts`, `machines/MachineRegistry.tsx`). Everything else uses `useApi()` inside
 * a machine provider and `useMachineApi(id)` outside one (tests use `apiOfMachine()`).
 * `lib/api-singleton.test.ts` fails when another file starts importing it.
 */
export const API_SINGLETON_BASELINE: readonly string[] = [
  "machines/MachineRegistry.tsx",
  "machines/machine-apis.ts",
];
