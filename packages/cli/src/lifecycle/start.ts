import { type LifecycleDeps, managerOf, realLifecycleDeps } from "./deps";
import { lifecycleFlagsOf } from "./flags";
import { openRunning } from "./open";
import { writeStoredPort } from "./port-store";

/** Starts the service of this home (a detached process when it has none), waits for the URL, prints it. */
export async function startAndWait(deps: LifecycleDeps, home: string): Promise<string> {
  if (!(await deps.readInstance(home))) await managerOf(deps, home).start();
  const instance = await deps.waitForInstanceUrl(home);
  if (!instance?.url) throw new Error("tau did not start. Run `tau logs` to see why.");
  return instance.url;
}

export async function runStartWith(deps: LifecycleDeps, argv: readonly string[]): Promise<void> {
  const flags = lifecycleFlagsOf(argv, deps.context);
  if (flags.explicitPort !== undefined) writeStoredPort(flags.home, flags.explicitPort);
  const url = await startAndWait(deps, flags.home);
  deps.out(`tau is running: ${url}`);
  if (flags.open) await openRunning(deps, flags.home);
}

/** `tau start [--port --home --no-open]`. */
export async function runStart(argv: readonly string[]): Promise<void> {
  await runStartWith(await realLifecycleDeps(), argv);
}
