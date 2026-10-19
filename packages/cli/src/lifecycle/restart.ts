import { ForegroundHolderError } from "../service/detached";
import { foregroundHolder } from "./bare-text";
import { type LifecycleDeps, managerOf, realLifecycleDeps } from "./deps";
import { lifecycleFlagsOf } from "./flags";
import { installOrRepairService } from "./install-or-repair";
import { writeStoredPort } from "./port-store";
import { gatherStatus } from "./status";

/** Repairs a stale service, copies PATH again, and restarts. */
export async function runRestartWith(deps: LifecycleDeps, argv: readonly string[]): Promise<void> {
  const flags = lifecycleFlagsOf(argv, deps.context);
  if (flags.explicitPort !== undefined) writeStoredPort(flags.home, flags.explicitPort);
  const status = await gatherStatus(deps, flags.home);
  if (status.running === "foreground" && status.pid !== null) {
    deps.out(foregroundHolder(status.pid));
    process.exitCode = 1;
    return;
  }
  const prepared = await installOrRepairService(deps, flags.home);
  if (prepared.kind === "failed") {
    deps.out(prepared.message);
    process.exitCode = 1;
    return;
  }
  const manager = managerOf(deps, flags.home);
  try {
    await manager.restart();
  } catch (error) {
    if (!(error instanceof ForegroundHolderError)) throw error;
    deps.out(error.message);
    process.exitCode = 1;
    return;
  }
  const instance = await deps.waitForInstanceUrl(flags.home);
  deps.out(instance?.url ? `tau is running: ${instance.url}` : "tau restarted.");
}

/** `tau restart`. */
export async function runRestart(argv: readonly string[]): Promise<void> {
  await runRestartWith(await realLifecycleDeps(), argv);
}
