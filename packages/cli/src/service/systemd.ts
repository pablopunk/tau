import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type ServiceBackend, ServiceCommandError } from "./backend";
import type { ServiceContext } from "./context";
import { renderSystemdUnit } from "./render";
import type { ServiceSpec } from "./spec";

const unitDirOf = (context: ServiceContext) => join(context.osHome, ".config", "systemd", "user");
export const unitPathOf = (context: ServiceContext, spec: ServiceSpec) =>
  join(unitDirOf(context), spec.names.systemdUnit);

export const hasUserSystemd = (context: ServiceContext) => Boolean(context.xdgRuntimeDir);

export function createSystemdBackend(context: ServiceContext): ServiceBackend {
  const systemctl = (...args: string[]) => context.runner.run("systemctl", ["--user", ...args]);
  const must = async (...args: string[]) => {
    const result = await systemctl(...args);
    if (result.code !== 0) throw new ServiceCommandError(`systemctl --user ${args[0]}`, result.stderr);
  };

  async function enableLinger(): Promise<string[]> {
    const result = await context.runner.run("loginctl", ["enable-linger", context.username]);
    return result.code === 0
      ? []
      : ["Could not enable linger: tau will not start after a reboot until you log in."];
  }

  return {
    kind: "systemd",
    files: (spec) => [{ path: unitPathOf(context, spec), content: renderSystemdUnit(spec) }],
    isInstalled: async (spec) => existsSync(unitPathOf(context, spec)),
    async install(spec) {
      const loaded = await systemctl("daemon-reload");
      const enabled = loaded.code === 0 && (await systemctl("enable", "--now", spec.names.systemdUnit));
      if (!enabled || enabled.code !== 0) {
        return {
          warnings: [
            "systemd --user refused the service (no user session?). tau runs detached and will not survive a reboot.",
          ],
          fellBack: true,
        };
      }
      return { warnings: await enableLinger() };
    },
    async reload(spec) {
      await must("daemon-reload");
      await must("restart", spec.names.systemdUnit);
    },
    async uninstall(spec) {
      await systemctl("disable", "--now", spec.names.systemdUnit);
    },
    start: (spec) => must("start", spec.names.systemdUnit),
    stop: (spec) => must("stop", spec.names.systemdUnit),
    restart: (spec) => must("restart", spec.names.systemdUnit),
    async state(spec) {
      const result = await systemctl("show", spec.names.systemdUnit, "-p", "MainPID", "-p", "ActiveState");
      const active = /ActiveState=active/.test(result.stdout);
      const pid = Number(/MainPID=(\d+)/.exec(result.stdout)?.[1] ?? 0);
      return { active, pid: pid > 0 ? pid : undefined };
    },
    async list() {
      const dir = unitDirOf(context);
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter((file) => /^tau(-[0-9a-f]+)?\.service$/.test(file));
    },
  };
}
