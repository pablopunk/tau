import type { ResourceSettings } from "@tau/protocol";
import { type Exec, execCommand } from "./exec";
import { createFootprint, type Footprint } from "./footprint";
import { createMemoryWatch, type MemoryWatch } from "./memory-watch";
import { createPsSweep, type Sweep } from "./ps-sweep";
import { anyControlOn, createResourceState, type ResourceState } from "./resource-state";
import { createResourceSupport, type ResourceSupportProbe } from "./resource-support";
import type { WrapSupport } from "./wrap-command";

/** Memory cap for every governed command. Generous on purpose: only runaways hit it. */
export const GOVERNED_MEMORY_LIMIT_MB = 4096;

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
    memoryLimitMb: () => deps.memoryLimitMb ?? GOVERNED_MEMORY_LIMIT_MB,
  };
}
