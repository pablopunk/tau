import { parseArgs } from "node:util";
import { cliEntry } from "../cli-entry";
import { realContext, type ServiceContext } from "./context";
import { createServiceManager, listServices, uninstallHome } from "./manager";

const USAGE = "Usage: tau service install | uninstall [--home <path>] | list";

export interface ServiceCommandDeps {
  readonly context: ServiceContext;
  readonly out: (message: string) => void;
}

/** `tau service install | uninstall [--home <path>] | list`. `argv` starts after the word `service`. */
export async function runServiceCommandWith(
  deps: ServiceCommandDeps,
  argv: readonly string[],
): Promise<void> {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { home: { type: "string" } },
  });
  const home = values.home ?? deps.context.env.TAU_HOME ?? deps.context.defaultHome;
  const [action] = positionals;
  if (action === "install") {
    const warnings = await createServiceManager(deps.context, cliEntry(), home).install();
    for (const warning of warnings) deps.out(`warning: ${warning}`);
    deps.out("tau service installed.");
  } else if (action === "uninstall") {
    await uninstallHome(deps.context, home);
    deps.out("tau service removed.");
  } else if (action === "list") {
    const names = await listServices(deps.context);
    deps.out(names.length === 0 ? "No tau services." : names.join("\n"));
  } else {
    throw new Error(USAGE);
  }
}

export async function runServiceCommand(argv: readonly string[]): Promise<void> {
  await runServiceCommandWith({ context: realContext(), out: (message) => console.log(message) }, argv);
}
