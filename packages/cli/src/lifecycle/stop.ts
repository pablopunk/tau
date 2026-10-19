import { type LifecycleDeps, managerOf, realLifecycleDeps } from "./deps";
import { lifecycleFlagsOf } from "./flags";
import { gatherStatus } from "./status";

export async function runStopWith(deps: LifecycleDeps, argv: readonly string[]): Promise<void> {
  const { home } = lifecycleFlagsOf(argv, deps.context);
  const status = await gatherStatus(deps, home);
  if (status.running === "foreground") {
    deps.out(
      `A terminal holds this tau (pid ${status.pid}), so there is no service to stop. Stop it with Ctrl+C.`,
    );
    return;
  }
  await managerOf(deps, home).stop();
  deps.out("tau stopped.");
}

/** `tau stop`: the service stays stopped until `tau start` or the next login. */
export async function runStop(argv: readonly string[]): Promise<void> {
  await runStopWith(await realLifecycleDeps(), argv);
}
