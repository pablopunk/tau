import type { ServiceBackend } from "./backend";
import type { ServiceContext } from "./context";
import { createDetachedBackend } from "./detached";
import { createLaunchdBackend } from "./launchd";
import { createSchtasksBackend, hasHeadlessConhost } from "./schtasks";
import { createSystemdBackend, hasUserSystemd } from "./systemd";

/** The OS service manager for this node, or undefined when it cannot host one. */
export function nativeBackendOf(context: ServiceContext): ServiceBackend | undefined {
  if (context.platform === "darwin") return createLaunchdBackend(context);
  if (context.platform === "linux")
    return hasUserSystemd(context) ? createSystemdBackend(context) : undefined;
  if (context.platform === "win32")
    return hasHeadlessConhost(context) ? createSchtasksBackend(context) : undefined;
  return undefined;
}

export const FALLBACK_WARNING =
  "No usable service manager here. tau runs detached and will not survive a reboot.";

export const detachedBackendOf = createDetachedBackend;
