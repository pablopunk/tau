import { compareVersions, isPlainVersion } from "@tau/protocol";
import { lifecycleFlagsOf } from "../lifecycle/flags";
import { gatherStatus } from "../lifecycle/status";
import { currentVersionOf, pruneVersions, swapCurrent } from "./install-layout";
import { installRelease } from "./install-release";
import { createJobReporter } from "./job-child";
import { linkedNodesLine } from "./nodes-behind";
import {
  type RestartOutcome,
  ROLLBACK_TIMEOUT_MS,
  restartCommandOf,
  restartInNewBinary,
} from "./restart-step";
import { hasRunningWork, runningWorkOf } from "./running-work";
import type { UpdateDeps } from "./update-deps";
import { type UpdateFlags, updateFlagsOf } from "./update-flags";
import * as text from "./update-text";
import { DEV_CHECKOUT_REASON, INSTALL_COMMAND, NO_BINARY_REASON } from "./updater";

export const EXIT_UPDATE_AVAILABLE = 10;

/** Why this tau cannot update itself, or undefined when it can. */
function refusalOf(deps: UpdateDeps): string | undefined {
  if (deps.installRoot === undefined) return DEV_CHECKOUT_REASON;
  if (deps.platformKey === undefined) return NO_BINARY_REASON;
  return undefined;
}

async function refusalForRunningWork(deps: UpdateDeps, home: string): Promise<string | undefined> {
  let all: Awaited<ReturnType<UpdateDeps["listConversations"]>>;
  try {
    all = await deps.listConversations(home);
  } catch (error) {
    return `Could not list the running threads (${error instanceof Error ? error.message : error}). Add --force to restart anyway.`;
  }
  const work = runningWorkOf(all, deps.env.TAU_THREAD_ID);
  const resuming = text.resumingText(work);
  if (resuming) deps.out(resuming);
  return hasRunningWork(work) ? text.runningWorkText(work) : undefined;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Download, verify, extract, run `--version`, swap `current`. Returns the problem, if any. */
async function installStep(deps: UpdateDeps, root: string, target: string, home: string) {
  try {
    const release = await deps.findRelease(target, home);
    await installRelease({ fetch: deps.fetch, run: deps.runCommand }, release, root);
    return undefined;
  } catch (error) {
    return text.failedInstallText(messageOf(error), INSTALL_COMMAND);
  }
}

/** Puts `current` back on the previous version; when the server was already restarted, restarts it again. */
async function rollBack(
  deps: UpdateDeps,
  root: string,
  previous: string | undefined,
  outcome: RestartOutcome,
  flags: UpdateFlags,
  target: string,
  home: string,
) {
  if (previous === undefined) return text.noRollbackText(target);
  swapCurrent(root, previous);
  if (outcome.restarted) {
    const { command, args } = restartCommandOf(deps, [...flags.forwarded]);
    await deps.runCommand(command, args, { stdio: "inherit" });
    await deps.pollRunningVersion(home, previous, ROLLBACK_TIMEOUT_MS);
  }
  return text.rolledBackText(target, previous);
}

async function finish(
  deps: UpdateDeps,
  flags: UpdateFlags,
  steps: { readonly root: string; readonly previous: string | undefined; readonly target: string },
  home: string,
): Promise<number> {
  const { root, previous, target } = steps;
  const outcome: RestartOutcome = flags.noRestart
    ? { code: noRestartNote(deps), restarted: false }
    : await restartInNewBinary(deps, { ...flags, target, home });
  if (outcome.code !== 0) {
    deps.err(await rollBack(deps, root, previous, outcome, flags, target, home));
    return 1;
  }
  pruneVersions(root, [target, previous], home);
  await nodesBehindNote(deps, home, target);
  deps.out(deps.hasHubFile(home) ? `${text.LINKED_NOTE}\n${text.LINKED_HUB_NOTE}` : text.LINKED_NOTE);
  return 0;
}

function noRestartNote(deps: UpdateDeps): number {
  deps.out("Updated. Run `tau restart` to use the new version.");
  return 0;
}

async function nodesBehindNote(deps: UpdateDeps, home: string, latest: string): Promise<void> {
  try {
    const line = linkedNodesLine(await deps.linkedNodes?.(home), latest);
    if (line) deps.out(line);
  } catch {
    // best effort
  }
}

async function checkOnly(deps: UpdateDeps, home: string, current: string, latest: string): Promise<number> {
  deps.out(`${current} -> ${latest}`);
  await nodesBehindNote(deps, home, latest);
  return compareVersions(current, latest) < 0 ? EXIT_UPDATE_AVAILABLE : 0;
}

async function latestOrError(deps: UpdateDeps): Promise<string | undefined> {
  try {
    return await deps.latestVersion();
  } catch (error) {
    deps.err(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

const problemOf = (errors: readonly string[]) => errors.join("\n").slice(0, 2000) || "The update failed.";

/** `tau update`; resolves to the exit code. As the detached updater child it also reports every step to the job file. */
export async function runUpdateWith(deps: UpdateDeps, argv: readonly string[]): Promise<number> {
  const flags = updateFlagsOf(argv);
  if (flags.target !== undefined && !isPlainVersion(flags.target)) {
    deps.err(`--target needs a plain version like 1.2.3, got: ${flags.target}`);
    return 1;
  }
  const home = lifecycleFlagsOf(argv, deps.context).home;
  const job =
    flags.target === undefined ? undefined : createJobReporter(deps.env, home, deps.pid ?? process.pid);
  if (job === undefined) return performUpdate(deps, flags, argv, home);
  const errors: string[] = [];
  const tracked: UpdateDeps = {
    ...deps,
    job,
    err: (message) => {
      errors.push(message);
      deps.err(message);
    },
  };
  let code = 1;
  try {
    code = await performUpdate(tracked, flags, argv, home);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (code === 0) job.step("idle");
  else job.step("failed", problemOf(errors));
  await job.release(deps.runCommand);
  return code;
}

async function performUpdate(
  deps: UpdateDeps,
  flags: UpdateFlags,
  argv: readonly string[],
  home: string,
): Promise<number> {
  const current = deps.version();
  const latest = flags.target ?? (await latestOrError(deps));
  if (latest === undefined) return 1;
  if (flags.check) return checkOnly(deps, home, current, latest);
  if (compareVersions(current, latest) >= 0) {
    deps.out(`tau ${current} is up to date. ${text.LAG_NOTE}`);
    return 0;
  }
  const refusal = refusalOf(deps);
  const root = deps.installRoot;
  if (refusal !== undefined || root === undefined) {
    deps.err(refusal ?? DEV_CHECKOUT_REASON);
    return 1;
  }
  const running = (await gatherStatus(deps, home)).running;
  if ((running === "service" || running === "background") && !flags.noRestart && !flags.force) {
    const refusal = await refusalForRunningWork(deps, home);
    if (refusal) {
      deps.err(refusal);
      return 1;
    }
  }
  const question = `Install ${current} -> ${latest}${flags.noRestart ? "" : " and restart"}?`;
  if (!flags.yes) {
    if (!deps.isTty) {
      deps.err(text.NON_TTY_NEEDS_YES);
      return 1;
    }
    if (!(await deps.confirm(question))) {
      deps.out("Cancelled.");
      return 0;
    }
  }
  const previous = currentVersionOf(root);
  const failed = await installStep(deps, root, latest, home);
  if (failed) {
    deps.err(failed);
    return 1;
  }
  return finish(deps, flags, { root, previous, target: latest }, home);
}

export async function runUpdate(argv: readonly string[]): Promise<void> {
  const { realUpdateDeps } = await import("./real-deps");
  process.exitCode = await runUpdateWith(await realUpdateDeps(), argv);
}
