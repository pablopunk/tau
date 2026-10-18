import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type ServiceBackend, ServiceCommandError } from "./backend";
import type { ServiceContext } from "./context";
import { renderPlist } from "./render";
import type { ServiceSpec } from "./spec";

const plistDirOf = (context: ServiceContext) => join(context.osHome, "Library", "LaunchAgents");
export const plistPathOf = (context: ServiceContext, spec: ServiceSpec) =>
  join(plistDirOf(context), `${spec.names.launchdLabel}.plist`);

const PID_LINE = /^\s*pid = (\d+)/m;

export function createLaunchdBackend(context: ServiceContext): ServiceBackend {
  const launchctl = (...args: string[]) => context.runner.run("launchctl", args);
  const domains = [`gui/${context.uid}`, `user/${context.uid}`];

  async function liveDomain(): Promise<string | undefined> {
    for (const domain of domains) if ((await launchctl("print", domain)).code === 0) return domain;
    return undefined;
  }
  const targetOf = async (spec: ServiceSpec) =>
    `${(await liveDomain()) ?? domains[0]}/${spec.names.launchdLabel}`;

  async function bootstrap(spec: ServiceSpec): Promise<boolean> {
    for (const domain of domains) {
      const result = await launchctl("bootstrap", domain, plistPathOf(context, spec));
      if (result.code === 0) return true;
    }
    return false;
  }

  return {
    kind: "launchd",
    files: (spec) => [{ path: plistPathOf(context, spec), content: renderPlist(spec) }],
    isInstalled: async (spec) => existsSync(plistPathOf(context, spec)),
    async install(spec) {
      await launchctl("bootout", await targetOf(spec));
      if (await bootstrap(spec)) return { warnings: [] };
      return {
        warnings: [
          "launchd refused the service (no GUI session?). tau runs detached and will not survive a reboot.",
        ],
        fellBack: true,
      };
    },
    async reload(spec) {
      await launchctl("bootout", await targetOf(spec));
      if (!(await bootstrap(spec)))
        throw new ServiceCommandError("launchctl bootstrap", "the job could not be loaded");
    },
    async uninstall(spec) {
      await launchctl("bootout", await targetOf(spec));
    },
    async start(spec) {
      if (await bootstrap(spec)) return;
      throw new ServiceCommandError("launchctl bootstrap", "the job could not be loaded");
    },
    async stop(spec) {
      await launchctl("bootout", await targetOf(spec));
    },
    async restart(spec) {
      const result = await launchctl("kickstart", "-k", await targetOf(spec));
      if (result.code !== 0) throw new ServiceCommandError("launchctl kickstart", result.stderr);
    },
    async state(spec) {
      const result = await launchctl("print", await targetOf(spec));
      if (result.code !== 0) return { active: false };
      const pid = PID_LINE.exec(result.stdout)?.[1];
      return { active: pid !== undefined, pid: pid === undefined ? undefined : Number(pid) };
    },
    async list() {
      const dir = plistDirOf(context);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((file) => /^dev\.tau\.server(\.[0-9a-f]+)?\.plist$/.test(file))
        .map((file) => file.replace(/\.plist$/, ""));
    },
  };
}
