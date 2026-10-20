import type { CliCommand } from "../cli-entry";
import type { ServiceContext } from "../service/context";
import { buildSpec } from "../service/spec";
import { logFileOf } from "./job-file";

/**
 * macOS fallback: run the child under `launchctl submit` instead of a plain detached spawn. Only the unverified
 * gate may switch it on: flip it if the detached child dies with the service on launchd (UPDATE-BUTTON.md section 2).
 */
export const LAUNCHD_USE_SUBMIT = false;

export interface ChildRequest {
  readonly context: ServiceContext;
  readonly cli: CliCommand;
  readonly home: string;
  readonly target: string;
  readonly nonce: string;
  readonly kind: "launchd" | "systemd" | "schtasks" | "detached";
  readonly env: NodeJS.ProcessEnv;
  readonly epoch: number;
  /** Test hook: a script that replaces the real child. */
  readonly fakeScript?: string;
}

export const unitNameOf = (epoch: number) => `tau-update-${epoch}`;

/** The environment of the child: ours minus `TAU_THREAD_ID`, plus the job nonce. Never a replacement. */
export function childEnvOf(env: NodeJS.ProcessEnv, nonce: string): NodeJS.ProcessEnv {
  const { TAU_THREAD_ID: _thread, ...rest } = env;
  return { ...rest, TAU_UPDATE_JOB: nonce };
}

export const childArgsOf = (entry: string, target: string, home: string): string[] => [
  entry,
  "update",
  "--target",
  target,
  "--yes",
  "--force",
  "--home",
  home,
];

export function systemdRunArgs(request: ChildRequest, spec: { path: string }): string[] {
  const { home, context } = request;
  return [
    "--user",
    "--collect",
    "--quiet",
    `--unit=${unitNameOf(request.epoch)}`,
    `--working-directory=${home}`,
    `--setenv=PATH=${spec.path}`,
    `--setenv=HOME=${context.osHome}`,
    `--setenv=TAU_HOME=${home}`,
    "--setenv=TAU_UPDATE_JOB",
    "-p",
    `StandardOutput=file:${logFileOf(home)}`,
    "-p",
    "StandardError=inherit",
    "--",
    request.cli.command,
    ...childArgsOf(request.cli.args[0] ?? "", request.target, home),
  ];
}

/** The nonce is on argv here (`launchctl submit` has no env option); it is only a guard rail. */
export function launchdSubmitArgs(request: ChildRequest, spec: { path: string }): string[] {
  const label = unitNameOf(request.epoch);
  const log = logFileOf(request.home);
  return [
    "submit",
    "-l",
    label,
    "-o",
    log,
    "-e",
    log,
    "--",
    "/usr/bin/env",
    `PATH=${spec.path}`,
    `HOME=${request.context.osHome}`,
    `TAU_HOME=${request.home}`,
    `TAU_UPDATE_JOB=${request.nonce}`,
    `TAU_UPDATE_LABEL=${label}`,
    request.cli.command,
    ...childArgsOf(request.cli.args[0] ?? "", request.target, request.home),
  ];
}

export const launchdRemoveArgs = (label: string): string[] => ["remove", label];

async function runOrThrow(request: ChildRequest, command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = await request.context.runner.run(command, args, env ? { env } : undefined);
  if (result.code !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
}

/** Starts the child where it outlives the service restart. Resolves once it is started, not when it is done. */
export async function spawnUpdateChild(request: ChildRequest): Promise<void> {
  const spec = buildSpec(request.context, request.cli, request.home);
  const env = childEnvOf(request.env, request.nonce);
  if (request.fakeScript === undefined && request.kind === "systemd") {
    return runOrThrow(request, "systemd-run", systemdRunArgs(request, spec), env);
  }
  if (request.fakeScript === undefined && request.kind === "launchd" && LAUNCHD_USE_SUBMIT) {
    return runOrThrow(request, "launchctl", launchdSubmitArgs(request, spec));
  }
  const entry = request.fakeScript ?? request.cli.args[0] ?? "";
  await request.context.runner.spawnDetached(
    request.cli.command,
    childArgsOf(entry, request.target, request.home),
    { env: { ...env, PATH: env.PATH ?? spec.path }, logFile: logFileOf(request.home) },
  );
}
