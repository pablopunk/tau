import { type BootstrapResult, bootstrap } from "./bootstrap";
import { type LifecycleDeps, managerOf, realLifecycleDeps } from "./deps";
import { lifecycleFlagsOf } from "./flags";
import { openRunning } from "./open";
import { writeStoredPort } from "./port-store";
import { startAndWait } from "./start";

function finishHandover(deps: LifecycleDeps, result: Exclude<BootstrapResult, { kind: "skip" }>): void {
  if (result.kind === "handedOver") {
    process.exitCode = result.code;
    return;
  }
  deps.out(result.message);
  process.exitCode = 1;
}

/** Bare `tau`: install when missing, repair when stale, start when stopped, open the browser. */
export async function runBareWith(deps: LifecycleDeps, argv: readonly string[]): Promise<void> {
  const handover = await bootstrap(deps, deps.bootstrap, argv);
  if (handover.kind !== "skip") return finishHandover(deps, handover);
  const flags = lifecycleFlagsOf(argv, deps.context);
  if (flags.explicitPort !== undefined) writeStoredPort(flags.home, flags.explicitPort);
  const manager = managerOf(deps, flags.home);
  if (!(await manager.installed()) || (await manager.needsRepair())) {
    for (const warning of await manager.install()) deps.out(`warning: ${warning}`);
  }
  const url = await startAndWait(deps, flags.home);
  deps.out(`tau is running: ${url}`);
  if (flags.open) await openRunning(deps, flags.home);
}

export async function runBare(argv: readonly string[]): Promise<void> {
  await runBareWith(await realLifecycleDeps(), argv);
}
