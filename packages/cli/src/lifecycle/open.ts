import { type LifecycleDeps, NOT_RUNNING, realLifecycleDeps, withToken } from "./deps";
import { lifecycleFlagsOf } from "./flags";

/** Opens the browser on a running server; returns the URL it opened. */
export async function openRunning(deps: LifecycleDeps, home: string): Promise<string> {
  const instance = await deps.waitForInstanceUrl(home);
  if (!instance?.url) throw new Error(NOT_RUNNING);
  const url = withToken(instance.url, await deps.readToken(home));
  try {
    await deps.openBrowser(url);
  } catch (error) {
    deps.out(`Could not open the browser (${error instanceof Error ? error.message : error}). Open ${url}`);
  }
  return url;
}

export async function runOpenWith(deps: LifecycleDeps, argv: readonly string[]): Promise<void> {
  const { home } = lifecycleFlagsOf(argv, deps.context);
  if (!(await deps.readInstance(home))) throw new Error(NOT_RUNNING);
  await openRunning(deps, home);
}

/** `tau open`. */
export async function runOpen(argv: readonly string[]): Promise<void> {
  await runOpenWith(await realLifecycleDeps(), argv);
}
