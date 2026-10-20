import { totalmem } from "node:os";
import type { ResourceSettings } from "@tau/protocol";
import { type Exec, execCommand } from "./exec";
import { createFootprint, type Footprint } from "./footprint";
import { createMemoryWatch, type MemoryWatch } from "./memory-watch";
import { createPsSweep, type Sweep } from "./ps-sweep";
import { anyControlOn, createResourceState, type ResourceState } from "./resource-state";
import { createResourceSupport, type ResourceSupportProbe } from "./resource-support";
import type { WrapSupport } from "./wrap-command";

/** Ceiling for the memory cap: generous on purpose, only runaways hit it. */
export const MAX_MEMORY_LIMIT_MB = 4096;
/** Floor: a 4 GB box still kills a runaway at 2 GB with room to breathe. */
export const MIN_MEMORY_LIMIT_MB = 1024;

/**
 * The memory cap for every governed command: 20% of the machine's RAM between 1 and 4 GB.
 * A fixed 4 GB never fires on a 4 GB box before the OOM killer takes the whole machine.
 */
export function sharedMemoryLimitMb(totalBytes: number): number {
  return Math.min(MAX_MEMORY_LIMIT_MB, Math.max(MIN_MEMORY_LIMIT_MB, Math.floor(totalBytes / 5 / 1048576)));
}

export interface GovernorDeps {
  readonly nodeId?: () => string;
  readonly state?: ResourceState;
  readonly graceMs: number;
  readonly exec?: Exec;
  readonly sweep?: Sweep;
  readonly footprint?: Footprint;
  readonly support?: ResourceSupportProbe;
  /** Tests shrink the cap so a small allocation trips it. */
  readonly memoryLimitMb?: number;
}

/** What a governed command needs before it can spawn. */
export interface Plan {
  readonly settings: ResourceSettings;
  /** Needs the Linux cgroup probe before spawn. */
  readonly probe: boolean;
}

export interface Governor {
  readonly state: ResourceState;
  /** Created on first use. */
  support(): ResourceSupportProbe;
  watch(): MemoryWatch;
  plan(): Plan | undefined;
  wrapSupport(cgroupMemory: boolean): WrapSupport;
  setResources(next: ResourceSettings): void;
  memoryLimitMb(): number;
}

export function createGovernor(deps: GovernorDeps): Governor {
  const state = deps.state ?? createResourceState();
  const exec = deps.exec ?? execCommand;
  let support = deps.support;
  let watch: MemoryWatch | undefined;
  const supportOf = () => {
    support ??= createResourceSupport({ nodeId: deps.nodeId ?? (() => "local"), exec });
    return support;
  };
  return {
    state,
    support: supportOf,
    watch() {
      watch ??= createMemoryWatch({
        sweep: deps.sweep ?? createPsSweep(exec),
        graceMs: deps.graceMs,
        footprint: deps.footprint ?? (supportOf().platform === "macos" ? createFootprint(exec) : undefined),
      });
      return watch;
    },
    plan() {
      const settings = state.get();
      if (!anyControlOn(settings)) return undefined;
      const probe = supportOf().platform === "linux";
      return { settings, probe };
    },
    wrapSupport: (cgroupMemory) => ({
      platform: supportOf().platform,
      binaries: supportOf().binaries(),
      cgroupMemory,
    }),
    setResources(next) {
      state.set(next);
    },
    memoryLimitMb: () => deps.memoryLimitMb ?? sharedMemoryLimitMb(totalmem()),
  };
}
