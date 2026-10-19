import { type LifecycleDeps, managerOf, realLifecycleDeps } from "./deps";
import { lifecycleFlagsOf } from "./flags";
import { NO_EXTRAS, renderExtras, type StatusExtras } from "./status-extras";

export interface StatusReport {
  readonly installed: boolean;
  readonly running: "service" | "background" | "foreground" | false;
  readonly pid: number | null;
  readonly url: string | null;
  readonly version: string | null;
  readonly cliVersion: string;
  readonly home: string;
  readonly node: string | null;
  readonly nodeMissing: boolean;
  readonly warnings: readonly string[];
  readonly uptimeSeconds: StatusExtras["uptimeSeconds"];
  readonly lastExit: StatusExtras["lastExit"];
  readonly tunnel: StatusExtras["tunnel"];
}

const RUNNING_WORDING = {
  service: "service",
  background: "background, not a service: it stops at reboot, run `tau` to install it",
  foreground: "foreground",
} as const;

const runningKindOf = (isService: boolean, isBackground: boolean): "service" | "background" | "foreground" =>
  isService ? "service" : isBackground ? "background" : "foreground";

export async function gatherStatus(deps: LifecycleDeps, home: string): Promise<StatusReport> {
  const manager = managerOf(deps, home);
  const [installed, state, instance] = await Promise.all([
    manager.installed(),
    manager.state(),
    deps.readInstance(home),
  ]);
  const extras = (await deps.extras?.(home, instance)) ?? NO_EXTRAS;
  const recorded = manager.recorded();
  const nodeMissing = installed && recorded !== undefined && !deps.fileExists(recorded.node);
  const cliVersion = deps.version();
  const managedPid = state.pid;
  const isService =
    state.kind !== "detached" && state.active && (managedPid === undefined || managedPid === instance?.pid);
  const isBackground =
    state.kind === "detached" && state.active && (managedPid === undefined || managedPid === instance?.pid);
  const warnings: string[] = [];
  if (instance?.version !== undefined && instance.version !== cliVersion) {
    warnings.push(`Running version ${instance.version} is not ${cliVersion}: run \`tau restart\`.`);
  }
  if (nodeMissing) warnings.push("node missing: run `tau` to repair the service.");
  return {
    installed,
    running: instance ? runningKindOf(isService, isBackground) : false,
    pid: instance?.pid ?? null,
    url: instance?.url ?? null,
    version: instance?.version ?? null,
    cliVersion,
    home,
    node: recorded?.node ?? null,
    nodeMissing,
    warnings,
    ...extras,
  };
}

export function renderStatus(report: StatusReport): string {
  const running = report.running ? `running (${RUNNING_WORDING[report.running]})` : "not running";
  return [
    `tau: ${running}`,
    `installed: ${report.installed ? "yes" : "no"}`,
    `pid: ${report.pid ?? "-"}`,
    `url: ${report.url ?? "-"}`,
    `version: ${report.version ?? "-"}`,
    `home: ${report.home}`,
    `node: ${report.node ?? "-"}${report.nodeMissing ? " (missing)" : ""}`,
    ...renderExtras(report),
    ...report.warnings.map((warning) => `warning: ${warning}`),
  ].join("\n");
}

/** `tau status [--json]`. */
export async function runStatusWith(deps: LifecycleDeps, argv: readonly string[]): Promise<void> {
  const flags = lifecycleFlagsOf(argv, deps.context);
  const report = await gatherStatus(deps, flags.home);
  deps.out(flags.json ? JSON.stringify(report) : renderStatus(report));
}

export async function runStatus(argv: readonly string[]): Promise<void> {
  await runStatusWith(await realLifecycleDeps(), argv);
}
