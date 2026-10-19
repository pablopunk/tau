import { ForegroundHolderError } from "../service/detached";
import { TemporaryEntryError } from "../service/entry-guard";
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
  if (error instanceof TemporaryEntryError) return text.RUN_NPX_HINT;
  if (error instanceof ForegroundHolderError) return error.message;
  return text.serviceInstallFailed(error instanceof Error ? error.message : String(error));
}

/**
 * The install-or-repair step of bare `tau`, shared with `tau restart` and the update restart step
 * (UPDATE-BUTTON.md, "Service gap"). Refuses a foreground holder and keeps the npx hint. A background (non-service)
 * tau is stopped before a native install, because `launchctl bootstrap` fails while it holds the port.
 */
export async function installOrRepairService(deps: LifecycleDeps, home: string): Promise<InstallOrRepair> {
  const manager = managerOf(deps, home);
  const installed = await manager.installed();
  const status = installed ? await gatherStatus(deps, home) : undefined;
  if (status?.running === "foreground" && status.pid !== null) {
    return { kind: "failed", message: text.foregroundHolder(status.pid) };
  }
  const recorded = manager.recorded();
  const stale = manager.native
    ? installed && (await manager.needsRepair())
    : recorded !== undefined &&
      (recorded.node !== manager.spec.node || recorded.entry !== manager.spec.entry);
  const needsInstall = manager.native ? !installed || stale : recorded === undefined || stale;
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
