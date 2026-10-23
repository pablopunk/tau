import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceSupport, SandboxMechanism, SandboxSupport } from "@tau/protocol";
import { assertWriteAllowed, SandboxDenied } from "../../harness/tools/sandbox-path";
import { type Exec, execCommand, systemdEnv } from "./exec";
import { POLLED_NOTE, probeFailedText, UNSUPPORTED_NOTE } from "./governor-text";
import { type Binaries, findOnPath, type HostPlatform, hostPlatform, resolveBinaries } from "./wrap-command";

export const PROBE_TTL_MS = 5000;
export const PROBE_TIMEOUT_MS = 2000;
/** Single bound for probe+retry+clear while a spawn holds a heavy slot. */
export const PRESPAWN_DEADLINE_MS = 6000;
export const REPROBE_MS = 30_000;
const MEMORY_MAX_BYTES = 64 * 1024 * 1024;
/** Shell builtins only: a minimal PATH (or none) must not break the probe. */
export const FIRST_PROBE_SCRIPT =
  'read line < /proc/self/cgroup; read max < "/sys/fs/cgroup${line#0::}/memory.max"; echo "$max"';

export interface ProbeOutcome {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface MemoryPreparation {
  /** A scope can be used for this command. */
  readonly cgroupMemory: boolean;
  /** Set on exactly one command: the transition into degraded. */
  readonly failure?: string;
}

export interface ResourceSupportProbe {
  readonly platform: HostPlatform;
  /** Resolved on first use, never at startup. */
  binaries(): Binaries;
  /** Lazy; only the memory-limit spawn on Linux calls it. */
  prepareMemory(): Promise<MemoryPreparation>;
  /**
   * For the settings panel. Also carries the sandbox capability result (typed
   * as `SandboxSupport` in `@tau/protocol`): the response schema gains the
   * field in the integrator's pass; the runtime already reports it.
   */
  describe(): Promise<ResourceSupport>;
  /** The unit name for a scope of one command. */
  unitFor(entryId: string): string;
  /** `systemctl show` read-back for a finished scope: `memory` on `Result=oom-kill`. */
  scopeVerdict(unit: string): Promise<"memory" | undefined>;
  stop(): void;
}

export interface SupportDeps {
  readonly nodeId: () => string;
  readonly exec?: Exec;
  readonly platform?: HostPlatform;
  /** Test seam: skip the PATH scan. */
  readonly binaries?: Binaries;
  /** Test seam: the contents of `/proc/self/cgroup`. */
  readonly selfCgroup?: () => string | undefined;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Does `nice`/`chrt` fail to rank against the user's own terminal? Measured on Debian 13 (4 CPUs, 4 busy loops in
 * an ssh session): tau in that `session-N.scope` gets 52% / 27% / 0.2% of a free CPU at Off / Balanced / Background;
 * tau as a `systemd --user` service (`app.slice/<unit>.service`) gets 100% / 100% / 85%, because the kernel shares CPU
 * between cgroups first and priority only ranks inside one. So: a `.scope` leaf (a session or a terminal's own scope)
 * means commands share tau's cgroup with the user; anything else (a service, a bare slice, cgroup v1, unreadable) does not.
 */
export function priorityIsCgroupLimited(procSelfCgroup: string | undefined): boolean {
  const line = procSelfCgroup?.split("\n").find((entry) => entry.startsWith("0::"));
  if (line === undefined) return true;
  const leaf = line.slice(3).split("/").filter(Boolean).pop() ?? "";
  return !leaf.endsWith(".scope");
}

const readSelfCgroup = () => {
  try {
    return readFileSync("/proc/self/cgroup", "utf8");
  } catch {
    return undefined;
  }
};

/**
 * Which Layer-1 backend could confine a spawn here. Binary presence only
 * narrows the mechanism; `enforced` additionally needs the Layer-2 probe below.
 */
export function sandboxMechanism(
  platform: HostPlatform,
  binaries: Binaries,
  find: (name: string) => string | undefined = (name) => findOnPath(name),
): SandboxMechanism {
  if (platform === "macos") {
    return find("sandbox-exec") === undefined ? "none" : "seatbelt";
  }
  if (platform === "linux") {
    if (binaries.systemdRun !== undefined) return "systemd";
    return find("bwrap") === undefined ? "none" : "bwrap";
  }
  return "none";
}

/**
 * Tests the actual Layer-2 enforcement path at probe time: an inside write
 * through the confined open must succeed while an outside write must deny.
 * Never a bare platform check.
 */
export async function probeSandboxLayer2(): Promise<{ ok: boolean; note: string | null }> {
  const scratch = await mkdtemp(join(tmpdir(), "tau-sandbox-probe-"));
  try {
    await assertWriteAllowed(join(scratch, "inside.txt"), scratch, scratch);
    try {
      await assertWriteAllowed(join(scratch, "..", "outside.txt"), scratch, scratch);
    } catch (error) {
      if (error instanceof SandboxDenied) return { ok: true, note: null };
      throw error;
    }
    return { ok: false, note: "The confinement check allowed a write outside its root." };
  } catch (error) {
    if (error instanceof SandboxDenied) {
      return { ok: false, note: "The confinement check denied a write inside its own root." };
    }
    return { ok: false, note: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Capability result for the support query: mechanism plus a live Layer-2 test. */
export async function sandboxSupportOf(
  platform: HostPlatform,
  binaries: Binaries,
  find?: (name: string) => string | undefined,
): Promise<SandboxSupport> {
  const mechanism = sandboxMechanism(platform, binaries, find);
  const layer2 = await probeSandboxLayer2();
  const enforced = mechanism !== "none" && layer2.ok;
  const note = !layer2.ok
    ? layer2.note
    : mechanism === "none"
      ? "No Layer-1 backend here (sandbox-exec on macOS, systemd-run or bwrap on Linux): spawns run unenforced."
      : "Probe-tested with a scratch root; threads are confined only while the sandbox switch is on.";
  return { enforced, mechanism, tested: true, note };
}

/** Fixed-length and `[0-9a-f]` only, so `tau-<id>-*` never matches another node id. */
export const unitNodeId = (nodeId: string) => createHash("sha256").update(nodeId).digest("hex").slice(0, 12);

export function createResourceSupport(deps: SupportDeps): ResourceSupportProbe {
  const exec = deps.exec ?? execCommand;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const platform = deps.platform ?? hostPlatform();
  let resolved: Binaries | undefined;
  const binaries = () => {
    resolved ??= deps.binaries ?? resolveBinaries(platform);
    return resolved;
  };
  const env = () => ({ ...(deps.env ?? process.env), ...systemdEnv(deps.env) });
  const prefix = () => `tau-${unitNodeId(deps.nodeId())}`;

  let cached: { at: number; outcome: ProbeOutcome } | undefined;
  let inflight: Promise<ProbeOutcome> | undefined;
  let verified = false;
  let degraded = false;
  let cleared = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const runProbe = async (): Promise<ProbeOutcome> => {
    const { systemdRun, sh } = binaries();
    if (!systemdRun) return { ok: false, reason: "systemd-run was not found" };
    const unit = `tau-probe-${unitNodeId(deps.nodeId())}-${randomBytes(6).toString("hex")}`;
    const command = verified
      ? ["--", "true"]
      : [
          "-p",
          `MemoryMax=${MEMORY_MAX_BYTES / 1024 / 1024}M`,
          "--",
          sh ?? "/bin/sh",
          "-c",
          FIRST_PROBE_SCRIPT,
        ];
    const args = ["--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, ...command];
    const result = await exec(systemdRun, args, { env: env(), timeoutMs: PROBE_TIMEOUT_MS });
    if (result.timedOut) return { ok: false, reason: "the cgroup probe timed out" };
    if (result.code !== 0) {
      return {
        ok: false,
        reason: result.stderr.trim().split("\n")[0] || "systemd-run --user --scope failed",
      };
    }
    if (!verified && Number(result.stdout.trim()) !== MEMORY_MAX_BYTES) {
      return { ok: false, reason: "the kernel did not apply a memory limit" };
    }
    verified = true;
    return { ok: true };
  };

  const probeWithRetry = async (): Promise<ProbeOutcome> => {
    const first = await runProbe();
    return first.reason?.includes("timed out") ? runProbe() : first;
  };

  const probe = (): Promise<ProbeOutcome> => {
    if (cached && now() - cached.at < PROBE_TTL_MS) return Promise.resolve(cached.outcome);
    inflight ??= probeWithRetry()
      .then((outcome) => {
        cached = { at: now(), outcome };
        return outcome;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };

  const startReprobe = () => {
    timer ??= setInterval(() => {
      cached = undefined;
      void probe().then((outcome) => {
        if (!outcome.ok) return;
        degraded = false;
        if (timer) clearInterval(timer);
        timer = undefined;
      });
    }, REPROBE_MS);
    timer.unref();
  };

  const clearLeftovers = async () => {
    if (cleared) return;
    cleared = true;
    await exec("systemctl", ["--user", "reset-failed", `${prefix()}-*.scope`], {
      env: env(),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  };

  // One deadline across probe+retry+clear: per-call timeouts stacking past ~8s
  // while a heavy slot is held would starve every waiter behind it.
  const prepareBounded = async (): Promise<ProbeOutcome> => {
    const prepared = (async () => {
      const outcome = await probe();
      if (outcome.ok) await clearLeftovers();
      return outcome;
    })();
    const timedOut = await Promise.race([
      prepared.then(() => false),
      sleep(PRESPAWN_DEADLINE_MS).then(() => true),
    ]);
    if (timedOut) return { ok: false, reason: "the cgroup probe timed out" };
    return prepared;
  };

  return {
    platform,
    binaries,
    async prepareMemory() {
      if (degraded) return { cgroupMemory: false };
      const outcome = await prepareBounded();
      if (outcome.ok) {
        return { cgroupMemory: true };
      }
      // Spawns that shared this in-flight probe all land here: only the first takes the failure.
      if (degraded) return { cgroupMemory: false };
      degraded = true;
      startReprobe();
      return { cgroupMemory: false, failure: probeFailedText(outcome.reason ?? "unknown reason") };
    },
    async describe() {
      const sandbox = await sandboxSupportOf(platform, binaries());
      if (platform === "macos") {
        return {
          platform,
          memoryEnforcement: "polled",
          prioritySupported: binaries().taskpolicy !== undefined,
          sameCgroupOnly: false,
          note: POLLED_NOTE,
          ...{ sandbox },
        };
      }
      if (platform !== "linux") {
        return {
          platform,
          memoryEnforcement: "none",
          prioritySupported: false,
          sameCgroupOnly: false,
          note: UNSUPPORTED_NOTE,
          ...{ sandbox },
        };
      }
      const outcome = await probe();
      return {
        platform,
        memoryEnforcement: outcome.ok ? "kernel" : "polled",
        prioritySupported: binaries().nice !== undefined,
        sameCgroupOnly: priorityIsCgroupLimited((deps.selfCgroup ?? readSelfCgroup)()),
        note: outcome.ok ? null : `${outcome.reason ?? "cgroups unavailable"}. ${POLLED_NOTE}`,
        ...{ sandbox },
      };
    },
    unitFor: (entryId) => `${prefix()}-${entryId}`,
    async scopeVerdict(unit) {
      const scope = `${unit}.scope`;
      let verdict: "memory" | undefined;
      for (let waited = 0; waited <= 200; waited += 50) {
        const shown = await exec("systemctl", ["--user", "show", scope, "-p", "Result,ActiveState"], {
          env: env(),
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        const values = new Map(shown.stdout.split("\n").map((line) => line.split("=") as [string, string]));
        const state = values.get("ActiveState");
        verdict = values.get("Result") === "oom-kill" ? "memory" : undefined;
        if (state === "failed" || state === "inactive" || shown.code !== 0) break;
        await sleep(50);
      }
      await exec("systemctl", ["--user", "reset-failed", scope], {
        env: env(),
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      return verdict;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
