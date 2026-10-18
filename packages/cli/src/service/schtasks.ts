import { join } from "node:path";
import { type ServiceBackend, ServiceCommandError } from "./backend";
import type { ServiceContext } from "./context";
import { renderCmdWrapper, renderTaskXml } from "./render";
import { type ServiceSpec, wrapperOf } from "./spec";

const CONHOST_HEADLESS_BUILD = 17763;

export const hasHeadlessConhost = (context: ServiceContext) =>
  (context.windowsBuild ?? 0) >= CONHOST_HEADLESS_BUILD;

const utf16WithBom = (text: string) => Buffer.from(`\ufeff${text}`, "utf16le");

export const taskXmlPathOf = (spec: ServiceSpec) => join(spec.home, "bin", `${spec.names.taskName}.xml`);

export function createSchtasksBackend(context: ServiceContext): ServiceBackend {
  const schtasks = (...args: string[]) => context.runner.run("schtasks", args);
  const must = async (...args: string[]) => {
    const result = await schtasks(...args);
    if (result.code !== 0) throw new ServiceCommandError(`schtasks ${args[0]}`, result.stderr);
  };
  const queryOf = (spec: ServiceSpec) => schtasks("/query", "/tn", spec.names.taskName, "/fo", "csv", "/nh");

  return {
    kind: "schtasks",
    files: (spec) => [
      { path: wrapperOf(spec.home), content: renderCmdWrapper(spec) },
      { path: taskXmlPathOf(spec), content: utf16WithBom(renderTaskXml(wrapperOf(spec.home))) },
    ],
    isInstalled: async (spec) => (await queryOf(spec)).code === 0,
    async install(spec) {
      await must("/create", "/tn", spec.names.taskName, "/xml", taskXmlPathOf(spec), "/f");
      await must("/run", "/tn", spec.names.taskName);
      return { warnings: [] };
    },
    async uninstall(spec) {
      await schtasks("/end", "/tn", spec.names.taskName);
      await schtasks("/delete", "/tn", spec.names.taskName, "/f");
    },
    async reload(spec) {
      await must("/create", "/tn", spec.names.taskName, "/xml", taskXmlPathOf(spec), "/f");
      await schtasks("/end", "/tn", spec.names.taskName);
      await must("/run", "/tn", spec.names.taskName);
    },
    start: (spec) => must("/run", "/tn", spec.names.taskName),
    stop: (spec) => must("/end", "/tn", spec.names.taskName),
    async restart(spec) {
      await schtasks("/end", "/tn", spec.names.taskName);
      await must("/run", "/tn", spec.names.taskName);
    },
    async state(spec) {
      const result = await queryOf(spec);
      return { active: result.code === 0 && /Running/i.test(result.stdout) };
    },
    async list() {
      const result = await schtasks("/query", "/fo", "csv", "/nh");
      return result.stdout
        .split(/\r?\n/)
        .map((line) => /^"\\?(tau(?:-[0-9a-f]+)?)"/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined);
    },
  };
}
