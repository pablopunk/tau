import { TemporaryEntryError } from "../service/entry-guard";
import { type LifecycleDeps, managerOf, realLifecycleDeps } from "./deps";
import { lifecycleFlagsOf } from "./flags";
import { openRunning } from "./open";
import { writeStoredPort } from "./port-store";
import { startAndWait } from "./start";

type ServeInForeground = (argv: readonly string[]) => Promise<void>;

/** Bare `tau`: install when missing, repair when stale, start when stopped, open the browser. */
export async function runBareWith(
  deps: LifecycleDeps,
  argv: readonly string[],
  serveInForeground: ServeInForeground,
): Promise<void> {
  const flags = lifecycleFlagsOf(argv, deps.context);
  if (flags.explicitPort !== undefined) writeStoredPort(flags.home, flags.explicitPort);
  const manager = managerOf(deps, flags.home);
  if (!(await manager.installed()) || (await manager.needsRepair())) {
    try {
      for (const warning of await manager.install()) deps.out(`warning: ${warning}`);
    } catch (error) {
      if (!(error instanceof TemporaryEntryError)) throw error;
      deps.out(`warning: ${error.message} Serving in the foreground instead.`);
      return serveInForeground(argv);
    }
  }
  const url = await startAndWait(deps, flags.home);
  deps.out(`tau is running: ${url}`);
  if (flags.open) await openRunning(deps, flags.home);
}

export async function runBare(argv: readonly string[], serveInForeground: ServeInForeground): Promise<void> {
  await runBareWith(await realLifecycleDeps(), argv, serveInForeground);
}
