import * as text from "./bare-text";
import { type LifecycleDeps, managerOf, withToken } from "./deps";
import { lifecycleFlagsOf } from "./flags";
import { installFailure, installOrRepairService } from "./install-or-repair";
import { openRunning } from "./open";
import { writeStoredPort } from "./port-store";

const WAITING_NOTICE_MS = 3000;

function fail(deps: LifecycleDeps, message: string): void {
  deps.out(message);
  process.exitCode = 1;
}

/** Waits for the URL; says once after 3 s that it is still waiting. */
async function waitForStart(deps: LifecycleDeps, home: string) {
  const timer = setTimeout(() => deps.out(text.WAITING_TO_START), WAITING_NOTICE_MS);
  try {
    return await deps.waitForInstanceUrl(home);
  } finally {
    clearTimeout(timer);
  }
}

/** Bare `tau`: install when missing, repair when stale, start when stopped, print the sign-in link. Never serves in the foreground. */
export async function runBareWith(deps: LifecycleDeps, argv: readonly string[]): Promise<void> {
  const flags = lifecycleFlagsOf(argv, deps.context);
  if (flags.explicitPort !== undefined) writeStoredPort(flags.home, flags.explicitPort);
  const { home } = flags;
  const manager = managerOf(deps, home);
  const version = deps.version();
  const prepared = await installOrRepairService(deps, home);
  if (prepared.kind === "failed") return fail(deps, prepared.message);
  const repairing = prepared.repairing;
  const before = await deps.readInstance(home);
  let changed = prepared.changed;
  try {
    if (before && before.version !== version) {
      if (!repairing) deps.out(text.REPAIRING);
      await manager.restart();
      changed = true;
    } else if (!before) {
      await manager.start();
      changed = true;
    }
  } catch (error) {
    return fail(deps, installFailure(error));
  }
  const instance = await waitForStart(deps, home);
  if (!instance?.url) return fail(deps, text.DID_NOT_START);
  const background = !manager.native || (await manager.state()).kind === "detached";
  if (background) {
    deps.out(text.NO_SERVICE_MANAGER);
    if (deps.context.platform === "linux") deps.out(text.LINGER_HINT);
  } else {
    deps.out(changed ? text.SERVICE_RUNNING : text.alreadyRunning(instance.version ?? version));
  }
  const link = flags.open
    ? await openRunning(deps, home)
    : withToken(instance.url, await deps.readToken(home));
  deps.out(text.openLine(link));
  deps.out(text.PAIR_LINE);
}

export async function runBare(argv: readonly string[]): Promise<void> {
  const { realLifecycleDeps } = await import("./deps");
  await runBareWith(await realLifecycleDeps(), argv);
}
