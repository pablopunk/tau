import { TemporaryEntryError } from "../service/entry-guard";
import { FALLBACK_WARNING } from "../service/pick-backend";
import * as text from "./bare-text";
import { type BootstrapResult, bootstrap } from "./bootstrap";
import { type LifecycleDeps, managerOf, withToken } from "./deps";
import { lifecycleFlagsOf } from "./flags";
import { openRunning } from "./open";
import { writeStoredPort } from "./port-store";
import { gatherStatus } from "./status";

const WAITING_NOTICE_MS = 3000;
const FOREGROUND_PREFIX = "tau is already running in a terminal";

function finishHandover(deps: LifecycleDeps, result: Exclude<BootstrapResult, { kind: "skip" }>): void {
  if (result.kind === "handedOver") {
    process.exitCode = result.code;
    return;
  }
  deps.out(result.message);
  process.exitCode = 1;
}

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

function installFailure(error: unknown): string {
  if (error instanceof TemporaryEntryError) return text.RUN_NPX_HINT;
  if (error instanceof Error && error.message.startsWith(FOREGROUND_PREFIX)) return error.message;
  return text.serviceInstallFailed(error instanceof Error ? error.message : String(error));
}

/** Bare `tau`: install when missing, repair when stale, start when stopped, print the sign-in link. Never serves in the foreground. */
export async function runBareWith(deps: LifecycleDeps, argv: readonly string[]): Promise<void> {
  const handover = await bootstrap(deps, deps.bootstrap, argv);
  if (handover.kind !== "skip") return finishHandover(deps, handover);
  const flags = lifecycleFlagsOf(argv, deps.context);
  if (flags.explicitPort !== undefined) writeStoredPort(flags.home, flags.explicitPort);
  const { home } = flags;
  const manager = managerOf(deps, home);
  const installed = await manager.installed();
  const status = installed ? await gatherStatus(deps, home) : undefined;
  if (status?.running === "foreground" && status.pid !== null) {
    return fail(deps, text.foregroundHolder(status.pid));
  }
  const version = deps.version();
  const recorded = manager.recorded();
  const stale = manager.native
    ? installed && (await manager.needsRepair())
    : recorded !== undefined &&
      (recorded.node !== manager.spec.node || recorded.entry !== manager.spec.entry);
  const needsInstall = manager.native ? !installed || stale : recorded === undefined || stale;
  let repairing = false;
  if (needsInstall) {
    repairing = stale;
    if (stale) deps.out(text.REPAIRING);
    else if (manager.native) deps.out(text.installingService(manager.kind));
    try {
      for (const warning of await manager.install()) {
        if (warning !== FALLBACK_WARNING) deps.out(`warning: ${warning}`);
      }
    } catch (error) {
      return fail(deps, installFailure(error));
    }
  }
  const before = await deps.readInstance(home);
  let changed = needsInstall;
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
