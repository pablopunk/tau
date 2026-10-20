import type { ResourceSettings } from "@tau/protocol";
import { type Exec, execCommand } from "./exec";
import { isHeavyCommand } from "./heavy-command";
import { createMemoryWatch, type MemoryWatch } from "./memory-watch";
import { createPsSweep, type Sweep } from "./ps-sweep";
import { createResourceState, type ResourceState } from "./resource-state";
import { createResourceSupport, type ResourceSupportProbe } from "./resource-support";
import { createSlotQueue, type SlotQueue } from "./slot-queue";
import type { WrapSupport } from "./wrap-command";

export interface GovernorDeps {
  readonly nodeId?: () => string;
  readonly state?: ResourceState;
  /** Fires on every change of the heavy-command queue. */
  readonly onActivity?: () => void;
  readonly graceMs: number;
  readonly exec?: Exec;
  readonly sweep?: Sweep;
  readonly support?: ResourceSupportProbe;
}

/** What a governed command needs before it can spawn. */
export interface Plan {
  readonly settings: ResourceSettings;
  /** Takes a heavy slot (foreground bash that looks heavy). */
  readonly slot: boolean;
  /** Needs the Linux cgroup probe before spawn. */
  readonly probe: boolean;
}

export interface Governor {
  readonly state: ResourceState;
  readonly queue: SlotQueue;
  /** Created on first use. */
  support(): ResourceSupportProbe;
  watch(): MemoryWatch;
  plan(command: string, foreground: boolean): Plan;
  wrapSupport(cgroupMemory: boolean): WrapSupport;
  setResources(next: ResourceSettings): void;
}

export function createGovernor(deps: GovernorDeps): Governor {
  const state = deps.state ?? createResourceState();
  const queue = createSlotQueue(state.get().heavySlots, deps.onActivity);
  const exec = deps.exec ?? execCommand;
  let support = deps.support;
  let watch: MemoryWatch | undefined;
  const supportOf = () => {
    support ??= createResourceSupport({ nodeId: deps.nodeId ?? (() => "local"), exec });
    return support;
  };
  return {
    state,
    queue,
    support: supportOf,
    watch() {
      watch ??= createMemoryWatch({ sweep: deps.sweep ?? createPsSweep(exec), graceMs: deps.graceMs });
      return watch;
    },
    plan(command, foreground) {
      const settings = state.get();
      const slot = foreground && settings.heavySlots !== null && isHeavyCommand(command);
      const probe = settings.memoryLimitMb !== null && supportOf().platform === "linux";
      return { settings, slot, probe };
    },
    wrapSupport: (cgroupMemory) => ({
      platform: supportOf().platform,
      binaries: supportOf().binaries(),
      cgroupMemory,
    }),
    setResources(next) {
      state.set(next);
      queue.setLimit(next.heavySlots);
    },
  };
}
