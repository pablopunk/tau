import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ServiceBackend } from "./backend";
import type { ServiceContext } from "./context";
import { pidFileOf, type ServiceSpec } from "./spec";

function readPid(file: string): number | undefined {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** A plain background process: used when the OS has no usable service manager, or for a home with no service. */
export function createDetachedBackend(context: ServiceContext): ServiceBackend {
  const livePid = (spec: ServiceSpec) => {
    const pid = readPid(pidFileOf(spec.home));
    return pid !== undefined && context.isAlive(pid) ? pid : undefined;
  };

  async function start(spec: ServiceSpec) {
    if (livePid(spec) !== undefined) return;
    const pid = await context.runner.spawnDetached(spec.node, [spec.entry, ...spec.args], {
      env: { ...context.env, PATH: spec.path },
    });
    if (pid === undefined) return;
    mkdirSync(dirname(pidFileOf(spec.home)), { recursive: true });
    writeFileSync(pidFileOf(spec.home), String(pid));
  }

  async function stop(spec: ServiceSpec) {
    const pid = livePid(spec);
    if (pid !== undefined) context.kill(pid);
    rmSync(pidFileOf(spec.home), { force: true });
  }

  return {
    kind: "detached",
    files: () => [],
    isInstalled: async () => false,
    async install(spec) {
      await start(spec);
      return { warnings: [] };
    },
    uninstall: stop,
    reload: async (spec) => {
      await stop(spec);
      await start(spec);
    },
    start,
    stop,
    async restart(spec) {
      await stop(spec);
      await start(spec);
    },
    async state(spec) {
      const pid = livePid(spec);
      return { active: pid !== undefined, pid };
    },
    list: async () => [],
  };
}
