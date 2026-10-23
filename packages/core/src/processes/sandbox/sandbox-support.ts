import { accessSync, constants } from "node:fs";
import type { HostPlatform } from "../governor/wrap-command";
import { hostPlatform } from "../governor/wrap-command";
import type { SandboxBinaries } from "./wrap";

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export interface SandboxCapability {
  readonly platform: HostPlatform;
  readonly binaries: SandboxBinaries;
  /** The actual enforcement path exists here, not just `platform !== "other"`. */
  readonly enforced: boolean;
  readonly note: string | null;
}

/**
 * Capability result that tests the real enforcement path: macOS needs
 * `sandbox-exec`, Linux needs `systemd-run` (or `bwrap`). Unsupported stays an
 * explicit "unenforced" state, never silent.
 */
export function probeSandboxSupport(
  platform: HostPlatform = hostPlatform(),
  binaries?: SandboxBinaries,
): SandboxCapability {
  const found: SandboxBinaries =
    binaries ??
    (platform === "macos"
      ? { sandboxExec: isExecutable("/usr/bin/sandbox-exec") ? "/usr/bin/sandbox-exec" : undefined }
      : {});
  const picked = Object.fromEntries(
    Object.entries(found).filter(([, value]) => value !== undefined),
  ) as SandboxBinaries;
  if (platform === "macos") {
    return picked.sandboxExec
      ? { platform, binaries: picked, enforced: true, note: null }
      : {
          platform,
          binaries: picked,
          enforced: false,
          note: "sandbox-exec is unavailable: spawned processes run unenforced.",
        };
  }
  if (platform === "linux") {
    return (picked.systemdRun ?? picked.bwrap)
      ? { platform, binaries: picked, enforced: true, note: null }
      : {
          platform,
          binaries: picked,
          enforced: false,
          note: "Neither systemd-run nor bwrap is available: spawned processes run unenforced.",
        };
  }
  return {
    platform,
    binaries: picked,
    enforced: false,
    note: "Sandboxing is unsupported on this platform: spawned processes run unenforced.",
  };
}
