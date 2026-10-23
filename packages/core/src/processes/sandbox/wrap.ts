import type { SandboxSettings } from "@tau/protocol";
import type { ThreadClass } from "../governor/governed";
import type { HostPlatform, Wrapped } from "../governor/wrap-command";
import { buildSeatbeltProfile } from "./profile";
import { buildBwrapPrefix, buildSystemdSandboxPrefix } from "./unit";

export interface SandboxBinaries {
  readonly sandboxExec?: string;
  readonly systemdRun?: string;
  readonly bwrap?: string;
}

export interface SandboxSupport {
  readonly platform: HostPlatform;
  readonly binaries: SandboxBinaries;
}

export interface SandboxWrapInput {
  readonly root: string;
  readonly scope: ThreadClass;
  readonly settings: SandboxSettings;
  readonly support: SandboxSupport;
  /** Stable per-process id for the Linux unit; ignored on macOS. */
  readonly unit: string;
  readonly workingDirectory: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly adminPaths?: readonly string[];
  readonly sshSocket?: string;
  /** Prefer `bwrap` over the systemd service where installed. */
  readonly preferBwrap?: boolean;
}

/** The node's sandbox switch, per scope. Absent settings mean the staging gate: everything off. */
export const sandboxEnabled = (settings: SandboxSettings, scope: ThreadClass): boolean =>
  settings[scope] === true;

export type SandboxBackend = "seatbelt" | "systemd" | "bwrap";

/** Which enforcement path a spawn takes, if any. Mirrors `sandboxPrefix` so callers can key unit ids off it. */
export function sandboxBackend(support: SandboxSupport, preferBwrap = false): SandboxBackend | null {
  const { platform, binaries } = support;
  if (platform === "macos" && binaries.sandboxExec) return "seatbelt";
  if (platform !== "linux") return null;
  if (preferBwrap && binaries.bwrap) return "bwrap";
  if (binaries.systemdRun) return "systemd";
  return null;
}

/**
 * The sandbox prefix for one spawn: OUTSIDE the governor wrap. `null` when
 * sandboxing is off for the scope or unsupported here (no binary for the
 * platform) — the caller then runs the governor wrap alone. Ends with the
 * separator where the platform needs one; the caller appends the inner
 * command (`governor file + args`, else `shell -c command`).
 */
export function sandboxPrefix(input: SandboxWrapInput): Wrapped | null {
  if (!sandboxEnabled(input.settings, input.scope)) return null;
  const { binaries } = input.support;
  if (sandboxBackend(input.support, input.preferBwrap) === "seatbelt" && binaries.sandboxExec) {
    return {
      file: binaries.sandboxExec,
      args: ["-p", buildSeatbeltProfile({ root: input.root, extraWritePaths: input.adminPaths })],
    };
  }
  if (sandboxBackend(input.support, input.preferBwrap) === "bwrap" && binaries.bwrap) {
    const bwrap = buildBwrapPrefix({
      bwrap: binaries.bwrap,
      root: input.root,
      adminPaths: input.adminPaths,
      sshSocket: input.sshSocket,
      env: input.env,
    });
    return { file: bwrap.file, args: bwrap.args };
  }
  if (sandboxBackend(input.support, input.preferBwrap) === "systemd" && binaries.systemdRun) {
    const unit = buildSystemdSandboxPrefix({
      systemdRun: binaries.systemdRun,
      root: input.root,
      unit: input.unit,
      workingDirectory: input.workingDirectory,
      env: input.env,
      adminPaths: input.adminPaths,
      sshSocket: input.sshSocket,
      sshSocketFromEnv: process.env.SSH_AUTH_SOCK,
    });
    return { file: unit.file, args: unit.args };
  }
  return null;
}

/**
 * Nesting order: sandbox OUTSIDE, governor (priority+memory) INSIDE. The
 * governor wrap execs the shell, so the sandboxed tree still leads with one
 * stable PID for the sweep.
 */
export function composeOuter(
  sandbox: Wrapped,
  inner: Wrapped | null,
  shell: string,
  command: string,
): Wrapped {
  const argv = inner ? [inner.file, ...inner.args] : [shell, "-c", command];
  return { file: sandbox.file, args: [...sandbox.args, ...argv] };
}
