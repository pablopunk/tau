import { installOrRepairService } from "../lifecycle/install-or-repair";
import { gatherStatus } from "../lifecycle/status";
import { isUpdateChild } from "./job-child";
import type { UpdateDeps } from "./update-deps";
import * as text from "./update-text";

/** How long the new server has to report `current === target` before the child swaps `current` back. */
export const ROLLBACK_TIMEOUT_MS = 60_000;

interface RestartRequest {
  readonly target: string;
  readonly home: string;
  readonly forwarded: readonly string[];
}

export interface RestartOutcome {
  readonly code: number;
  /** `tau restart` ran: the old server is gone, so a rollback must restart again. */
  readonly restarted: boolean;
}

export async function isInsideServer(deps: UpdateDeps, home: string): Promise<boolean> {
  if (deps.env.TAU_THREAD_ID) return true;
  if (isUpdateChild(deps.env, home, deps.pid ?? process.pid)) return false;
  const [instance, ancestors] = [
    await deps.readInstance(home),
    await (deps.ancestorPids?.() ?? Promise.resolve([] as readonly number[])),
  ];
  return instance !== undefined && ancestors.includes(instance.pid);
}

const notRestarted = (code: number): RestartOutcome => ({ code, restarted: false });

/** `<stable binary> restart`: `current/tau` is the NEW binary now. */
export const restartCommandOf = (deps: UpdateDeps, forwarded: readonly string[]) => {
  const cli = deps.cli();
  return { command: cli.command, args: [...cli.args, "restart", ...forwarded] };
};

/** Restarts the managed server with the NEW binary and waits until `GET /api/update` reports the target. */
export async function restartInNewBinary(deps: UpdateDeps, request: RestartRequest): Promise<RestartOutcome> {
  const running = (await gatherStatus(deps, request.home)).running;
  if (running === "foreground") return note(deps, text.FOREGROUND_NOTE);
  if (running === false) return note(deps, text.NOT_RUNNING_NOTE);
  if (await isInsideServer(deps, request.home)) {
    deps.err(text.INSIDE_TAU);
    return notRestarted(1);
  }
  const prepared = await installOrRepairService(deps, request.home, { keepDetached: true });
  if (prepared.kind === "failed") {
    deps.err(prepared.message);
    return notRestarted(1);
  }
  deps.job?.step("restarting");
  const { command, args } = restartCommandOf(deps, request.forwarded);
  const result = await deps.runCommand(command, args, { stdio: "inherit" });
  if (result.code !== 0) {
    deps.err("`tau restart` failed. Check `tau status` and `tau logs`.");
    return { code: 1, restarted: true };
  }
  const reported = await deps.pollRunningVersion(request.home, request.target, ROLLBACK_TIMEOUT_MS);
  if (reported !== request.target) {
    deps.err(text.skewText(reported, request.target));
    return { code: 1, restarted: true };
  }
  deps.out(`tau ${request.target} is running.`);
  return { code: 0, restarted: true };
}

function note(deps: UpdateDeps, message: string): RestartOutcome {
  deps.out(`Updated. ${message}`);
  return notRestarted(0);
}
