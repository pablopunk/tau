import { randomBytes } from "node:crypto";
import { IDLE_JOB, type UpdateInstall, type UpdateJob, type UpdaterPort } from "@tau/protocol";
import type { CliCommand } from "../cli-entry";
import type { ServiceContext } from "../service/context";
import { createServiceManager } from "../service/manager";
import { hasUserSystemd } from "../service/systemd";
import { fakeHooksAllowed } from "./fake-hooks";
import { GLOBAL_LATEST_COMMAND, installMethodOf, PNPM_LATEST_COMMAND } from "./install-method";
import { jobFileOf, logFileOf, readJobFile, writeJobFile } from "./job-file";
import { logTailOf } from "./log-tail";
import { spawnUpdateChild } from "./spawn-child";

/**
 * Per-backend gate: `install.mode` is `manual` on a backend until its real restart-survival run has passed
 * (UPDATE-BUTTON.md section 5). Flip a value only in the commit that records the passing run.
 * The detached backend and foreground runs have no supervisor, so they are `run` from the start.
 */
// Verified 2026-10-20: systemd 257 on Debian 13 (systemd-run child survived `systemctl --user restart`); launchd on
// macOS (detached child survived kickstart -k and bootout/bootstrap; bootstrap now waits for bootout).
export const BACKEND_VERIFIED = { systemd: true, launchd: true, detached: true } as const;

/** `--collect` of systemd-run needs systemd 236. */
export const MIN_SYSTEMD_VERSION = 236;
const NO_PID_GRACE_MS = 30_000;
const MAX_JOB_MS = 10 * 60_000;
export const FOREGROUND_REASON =
  "tau was not started as a service, so it will not restart. Restart it yourself afterwards.";
export const STOPPED_ERROR = "The update stopped before it finished.";

export interface UpdaterDeps {
  readonly home: string;
  /** This tau's version. */
  readonly version: string;
  readonly context: ServiceContext;
  /** node and entry of this tau, for the child. */
  readonly cli: CliCommand;
  /** `realpath(argv[1])`, for the install-method detection. */
  readonly entry: string;
  readonly execPath: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  readonly newNonce?: () => string;
  readonly isAlive?: (pid: number) => boolean;
  /** True when this server was not started with `--service` (a terminal `tau serve`): it cannot restart itself. */
  readonly foreground?: boolean;
}

/** The job file `<home>/update.json`; `from` stays here and is never sent to the web. */
export interface JobFile {
  readonly state: "installing" | "restarting" | "failed" | "idle";
  readonly target: string;
  readonly from: string;
  readonly nonce: string;
  readonly pid: number | null;
  readonly startedAt: number;
  readonly error: string | null;
}

export type BackendKind = "launchd" | "systemd" | "schtasks" | "detached";

const unverifiedReason = (kind: BackendKind) =>
  `Automatic update is not verified yet for ${kind === "detached" ? "this tau" : `the ${kind} service`}.`;

async function systemdVersionOf(deps: UpdaterDeps): Promise<number | undefined> {
  if (deps.context.platform !== "linux" || !hasUserSystemd(deps.context)) return undefined;
  const result = await deps.context.runner.run("systemctl", ["--version"]);
  const version = /systemd (\d+)/.exec(result.stdout)?.[1];
  return result.code === 0 && version !== undefined ? Number(version) : undefined;
}

interface Facts {
  readonly kind: BackendKind;
  readonly systemdVersion: number | undefined;
}

function planOf(deps: UpdaterDeps, facts: Facts, target: string): UpdateInstall {
  const method = installMethodOf({
    entry: deps.entry,
    execPath: deps.execPath,
    platform: deps.context.platform,
    target,
  });
  if (method.kind === "manual") {
    return {
      mode: method.manualCommand ? "manual" : "none",
      command: method.manualCommand ?? null,
      reason: method.reason,
    };
  }
  const manualCommand = method.kind === "pnpm" ? PNPM_LATEST_COMMAND : GLOBAL_LATEST_COMMAND;
  const manual = (reason: string): UpdateInstall => ({ mode: "manual", command: manualCommand, reason });
  const verified = (BACKEND_VERIFIED as Record<string, boolean>)[facts.kind] === true;
  if (!verified) return manual(unverifiedReason(facts.kind));
  if (facts.kind === "systemd" && (facts.systemdVersion ?? 0) < MIN_SYSTEMD_VERSION) {
    return manual(`Automatic update needs systemd ${MIN_SYSTEMD_VERSION} or newer.`);
  }
  return { mode: "run", command: null, reason: deps.foreground ? FOREGROUND_REASON : null };
}

async function factsOf(deps: UpdaterDeps): Promise<Facts> {
  const manager = createServiceManager(deps.context, deps.cli, deps.home);
  const kind: BackendKind = (await manager.installed()) ? manager.kind : "detached";
  return { kind, systemdVersion: kind === "systemd" ? await systemdVersionOf(deps) : undefined };
}

/** Plan from `installMethodOf` and `BACKEND_VERIFIED`, spawn per backend, job file with staleness rules. */
export async function createUpdater(deps: UpdaterDeps): Promise<UpdaterPort> {
  const facts = await factsOf(deps);
  const now = deps.now ?? Date.now;
  const env = deps.env ?? process.env;
  const isAlive = deps.isAlive ?? deps.context.isAlive;
  const newNonce = deps.newNonce ?? (() => randomBytes(16).toString("hex"));
  const fakeScript = env.TAU_FAKE_UPDATE && fakeHooksAllowed(deps.home) ? env.TAU_FAKE_UPDATE : undefined;
  /** Set when the job file cannot be written (disk full): the best we can say, in memory. */
  let unwritable: UpdateJob | undefined;

  function persist(job: JobFile): boolean {
    try {
      writeJobFile(deps.home, job);
      unwritable = undefined;
      return true;
    } catch (error) {
      unwritable = {
        state: "failed",
        target: job.target,
        error: `Could not write ${jobFileOf(deps.home)}: ${error instanceof Error ? error.message : error}`,
        logTail: null,
      };
      return false;
    }
  }

  const failed = (job: JobFile, error: string) => persist({ ...job, state: "failed", error });

  function staleVerdict(job: JobFile): JobFile | undefined {
    if (job.target === deps.version && job.state !== "idle") return { ...job, state: "idle", error: null };
    if (job.state === "failed" && deps.version !== job.from) return { ...job, state: "idle", error: null };
    if (job.state !== "installing" && job.state !== "restarting") return undefined;
    if (job.target === deps.version) return undefined;
    const age = now() - job.startedAt;
    if (job.pid === null)
      return age > NO_PID_GRACE_MS ? { ...job, state: "failed", error: STOPPED_ERROR } : undefined;
    if (!isAlive(job.pid)) return { ...job, state: "failed", error: STOPPED_ERROR };
    return age > MAX_JOB_MS ? { ...job, state: "failed", error: STOPPED_ERROR } : undefined;
  }

  function settled(): JobFile | undefined {
    const job = readJobFile(deps.home);
    if (job === undefined) return undefined;
    const next = staleVerdict(job);
    if (next === undefined) return job;
    persist(next);
    return next;
  }

  async function start(target: string): Promise<void> {
    const job: JobFile = {
      state: "installing",
      target,
      from: deps.version,
      nonce: newNonce(),
      pid: null,
      startedAt: now(),
      error: null,
    };
    if (!persist(job)) return;
    try {
      await spawnUpdateChild({
        context: deps.context,
        cli: deps.cli,
        home: deps.home,
        target,
        nonce: job.nonce,
        kind: facts.kind,
        env,
        epoch: now(),
        fakeScript,
      });
    } catch (error) {
      failed(job, error instanceof Error ? error.message : String(error));
    }
  }

  settled();

  return {
    plan: (target) => planOf(deps, facts, target),
    spawn: ({ target }) => start(target),
    async readJob() {
      const job = settled();
      if (job === undefined) return unwritable ?? IDLE_JOB;
      if (job.state === "idle") {
        return { ...IDLE_JOB, target: job.target === deps.version ? job.target : null };
      }
      return {
        state: job.state,
        target: job.target,
        error: job.error,
        logTail: logTailOf(logFileOf(deps.home)),
      };
    },
  };
}
