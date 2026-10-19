import type { LifecycleDeps } from "./deps";

export type InstallOrRepair =
  | { readonly kind: "ready"; readonly changed: boolean }
  | { readonly kind: "failed"; readonly message: string };

/**
 * The install-or-repair step of bare `tau`, shared with `tau restart` and the update restart step
 * (UPDATE-BUTTON.md, "Service gap"). Refuses a foreground holder and keeps the npx hint.
 * STUB (cli owner): extract it from `runBareWith` in `bare.ts`; on macOS stop a background instance before bootstrap.
 */
export async function installOrRepairService(_deps: LifecycleDeps, _home: string): Promise<InstallOrRepair> {
  throw new Error("installOrRepairService is not implemented yet");
}
