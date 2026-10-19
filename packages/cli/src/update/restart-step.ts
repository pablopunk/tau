import { gatherStatus } from "../lifecycle/status";
import { entryOfPackage } from "./install-method";
import type { UpdateDeps } from "./update-deps";
import * as text from "./update-text";

interface RestartRequest {
  readonly packageDir: string;
  readonly target: string;
  readonly home: string;
  readonly forwarded: readonly string[];
}

async function isInsideServer(deps: UpdateDeps, home: string): Promise<boolean> {
  if (deps.env.TAU_THREAD_ID) return true;
  const [instance, ancestors] = [
    await deps.readInstance(home),
    await (deps.ancestorPids?.() ?? Promise.resolve([] as readonly number[])),
  ];
  return instance !== undefined && ancestors.includes(instance.pid);
}

/** Restarts the managed server with the NEW binary and waits until the lock reports the target version. */
export async function restartInNewBinary(deps: UpdateDeps, request: RestartRequest): Promise<number> {
  const running = (await gatherStatus(deps, request.home)).running;
  if (running === "foreground") return note(deps, text.FOREGROUND_NOTE);
  if (running === false) return note(deps, text.NOT_RUNNING_NOTE);
  if (await isInsideServer(deps, request.home)) {
    deps.err(text.INSIDE_TAU);
    return 1;
  }
  const args = [entryOfPackage(request.packageDir), "restart", ...request.forwarded];
  const result = await deps.runCommand(deps.execPath, args, { stdio: "inherit" });
  if (result.code !== 0) {
    deps.err("`tau restart` failed. Check `tau status` and `tau logs`.");
    return 1;
  }
  const instance = await deps.pollInstance(request.home, request.target);
  if (instance?.version !== request.target) {
    deps.err(text.skewText(instance?.version, request.target));
    return 1;
  }
  deps.out(`tau ${request.target} is running.`);
  return 0;
}

function note(deps: UpdateDeps, message: string): number {
  deps.out(`Updated. ${message}`);
  return 0;
}
