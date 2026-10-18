import { type LifecycleDeps, managerOf, realLifecycleDeps } from "./deps";
import { lifecycleFlagsOf } from "./flags";
import { writeStoredPort } from "./port-store";

/** Repairs a stale service, copies PATH again, and restarts. */
export async function runRestartWith(deps: LifecycleDeps, argv: readonly string[]): Promise<void> {
  const flags = lifecycleFlagsOf(argv, deps.context);
  if (flags.explicitPort !== undefined) writeStoredPort(flags.home, flags.explicitPort);
  const manager = managerOf(deps, flags.home);
  if (await manager.needsRepair()) deps.out("Repairing the service.");
  await manager.restart();
  const instance = await deps.waitForInstanceUrl(flags.home);
  deps.out(instance?.url ? `tau is running: ${instance.url}` : "tau restarted.");
}

/** `tau restart`. */
export async function runRestart(argv: readonly string[]): Promise<void> {
  await runRestartWith(await realLifecycleDeps(), argv);
}
