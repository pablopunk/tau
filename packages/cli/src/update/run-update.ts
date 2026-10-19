import { compareVersions, isPlainVersion } from "@tau/protocol";
import { lifecycleFlagsOf } from "../lifecycle/flags";
import { gatherStatus } from "../lifecycle/status";
import { globalPackageDir } from "./global-package";
import { entryOfPackage, type InstallMethod, installMethodOf } from "./install-method";
import { createJobReporter } from "./job-child";
import { linkedNodesLine } from "./nodes-behind";
import { restartInNewBinary } from "./restart-step";
import { hasRunningWork, runningWorkOf } from "./running-work";
import type { UpdateDeps } from "./update-deps";
import { type UpdateFlags, updateFlagsOf } from "./update-flags";
import * as text from "./update-text";
import { verifyInstall } from "./verify-install";

export const EXIT_UPDATE_AVAILABLE = 10;

type Plan = { readonly packageDir: string; readonly install: InstallStep; readonly hint?: string };
interface InstallStep {
  readonly command: string;
  readonly args: readonly string[];
  readonly manual: string;
}

async function planOf(deps: UpdateDeps, target: string): Promise<Plan | string> {
  const method: InstallMethod = installMethodOf({
    entry: deps.entry,
    execPath: deps.execPath,
    platform: deps.context.platform,
    target,
  });
  if (method.kind === "manual") {
    return [method.reason, method.manualCommand ? `Run: ${method.manualCommand}` : ""]
      .filter(Boolean)
      .join("\n");
  }
  const install = { ...method.install, manual: method.manualCommand };
  if (method.kind === "npm") return { packageDir: method.packageDir, install, hint: method.hint };
  const packageDir = await globalPackageDir(deps, "pnpm");
  if (!packageDir) return `Could not find the pnpm global package.\nRun: ${method.manualCommand}`;
  return { packageDir, install };
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

async function installStep(deps: UpdateDeps, plan: Plan, current: string): Promise<string | undefined> {
  const { command, args, manual } = plan.install;
  const result = await deps.runCommand(command, args, { stdio: "tee" });
  if (result.code === 0) return undefined;
  if (/EACCES|EPERM/.test(result.stderr)) return text.permissionText(manual);
  return text.failedInstallText(manual, manual.replace(/@[^@]+$/, `@${current}`));
}

async function finish(
  deps: UpdateDeps,
  flags: UpdateFlags,
  plan: Plan,
  target: string,
  home: string,
): Promise<number> {
  const rollback = plan.install.manual.replace(/@[^@]+$/, `@${deps.version()}`);
  const problem = await verifyInstall(deps, plan.packageDir, target, home);
  if (problem) {
    deps.err(text.verifyFailedText(problem, rollback));
    return 1;
  }
  if (plan.hint) deps.out(plan.hint);
  const code = flags.noRestart
    ? noRestartNote(deps)
    : await restartInNewBinary(deps, { ...flags, packageDir: plan.packageDir, target, home });
  if (code === 0) await nodesBehindNote(deps, home, target);
  if (code === 0)
    deps.out(deps.hasHubFile(home) ? `${text.LINKED_NOTE}\n${text.LINKED_HUB_NOTE}` : text.LINKED_NOTE);
  return code;
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
  const plan = await planOf(deps, latest);
  if (typeof plan === "string") {
    deps.err(plan);
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
  const failed = await installStep(deps, plan, current);
  if (failed) {
    deps.err(failed);
    return 1;
  }
  return finish(deps, flags, plan, latest, home);
}

export { entryOfPackage };

export async function runUpdate(argv: readonly string[]): Promise<void> {
  const { realUpdateDeps } = await import("./real-deps");
  process.exitCode = await runUpdateWith(await realUpdateDeps(), argv);
}
