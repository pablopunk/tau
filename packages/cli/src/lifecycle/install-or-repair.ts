import { ForegroundHolderError } from "../service/detached";
import { FALLBACK_WARNING } from "../service/pick-backend";
import * as text from "./bare-text";
import { type LifecycleDeps, managerOf } from "./deps";
import { gatherStatus } from "./status";

export type InstallOrRepair =
  | {
      readonly kind: "ready";
      /** The service was installed or repaired by this call. */
      readonly changed: boolean;
      /** It was a repair of a stale definition (not a first install). */
      readonly repairing: boolean;
    }
  | { readonly kind: "failed"; readonly message: string };

function installFailure(error: unknown): string {
  if (error instanceof ForegroundHolderError) return error.message;
  return text.serviceInstallFailed(error instanceof Error ? error.message : String(error));
}

/**
 * `keepDetached` (restart, update): a recorded background tau on a node whose service manager refused the install
 * (launchd without a GUI session) stays detached; installing again would start a second server.
 *
 * The install-or-repair step of bare `tau`, shared with `tau restart` and the update restart step
 * (UPDATE-BUTTON.md, "Service gap"). Refuses a foreground holder. A background (non-service)
 * tau is stopped before a native install, because `launchctl bootstrap` fails while it holds the port.
 */
export async function installOrRepairService(
  deps: LifecycleDeps,
  home: string,
  options: { readonly keepDetached?: boolean } = {},
): Promise<InstallOrRepair> {
  const manager = managerOf(deps, home);
  const installed = await manager.installed();
  const status = installed ? await gatherStatus(deps, home) : undefined;
  if (status?.running === "foreground" && status.pid !== null) {
    return { kind: "failed", message: text.foregroundHolder(status.pid) };
  }
  const recorded = manager.recorded();
  const stale = (manager.native ? installed : recorded !== undefined) && (await manager.needsRepair());
  const needsInstall = manager.native ? !installed || stale : recorded === undefined || stale;
  if (options.keepDetached && manager.native && !installed && recorded !== undefined && !stale) {
    if ((await gatherStatus(deps, home)).running === "background") {
      return { kind: "ready", changed: false, repairing: false };
    }
  }
  if (!needsInstall) return { kind: "ready", changed: false, repairing: false };
  if (stale) deps.out(text.REPAIRING);
  else if (manager.native) deps.out(text.installingService(manager.kind));
  try {
    if (manager.native && !installed && (await gatherStatus(deps, home)).running === "background") {
      await manager.stop();
    }
    for (const warning of await manager.install()) {
      if (warning !== FALLBACK_WARNING) deps.out(`warning: ${warning}`);
    }
  } catch (error) {
    return { kind: "failed", message: installFailure(error) };
  }
  return { kind: "ready", changed: true, repairing: stale };
}

export { installFailure };
