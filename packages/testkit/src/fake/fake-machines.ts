import {
  AppError,
  type Change,
  type Core,
  HUB_LINK_NONE,
  type HubLink,
  type Machine,
  type MachineStatus,
  type MachineSummary,
  PROTOCOL_VERSION,
} from "@tau/protocol";
import type { FakeAccess } from "./fake-access";

export interface FakeMachines {
  readonly api: Core["machines"];
  /** Plays what the link would do: a machine goes offline, reconnecting or `update-required`. */
  setStatus(machineId: string, status: MachineStatus): void;
}

export interface FakeMachinesOptions {
  readonly now: () => number;
  readonly emit: (change: Change) => void;
  readonly access: Pick<FakeAccess, "revokeDevice" | "renameDevice" | "listDevices">;
}

/** The two machines a hub with `machines: true` starts with: one online, one offline. */
export const FAKE_MACHINE_SEEDS = [
  { name: "Homelab", os: "linux x64", tauVersion: "0.0.0", threadCount: 3, status: "online" },
  { name: "Work laptop", os: "win32 x64", tauVersion: "0.0.0", threadCount: 1, status: "offline" },
] as const;

/** A working in-memory registry, the executable spec for `core/src/machines`. */
export function createFakeMachines({ now, emit, access }: FakeMachinesOptions): FakeMachines {
  const machines = new Map<string, Machine>();
  const summaries = new Map<string, MachineSummary>();
  let link: HubLink = HUB_LINK_NONE;
  const announce = () => emit({ resource: "machines" });
  const set = (machine: Machine) => {
    machines.set(machine.id, machine);
    announce();
    return machine;
  };
  const require = (id: string) => {
    const machine = machines.get(id);
    if (!machine) throw new AppError("not_found", `No machine ${id}.`);
    return machine;
  };
  const api: Core["machines"] = {
    async list() {
      return [...machines.values()].map((machine) => ({ ...machine }));
    },
    async rename(id, name) {
      const machine = require(id);
      await access.renameDevice(id, name).catch(() => undefined);
      set({ ...machine, name });
    },
    async disconnect(id) {
      if (!machines.delete(id)) return;
      summaries.delete(id);
      await access.revokeDevice(id);
      announce();
    },
    hubState: async () => ({ ...link, os: "darwin arm64", name: "Mac" }),
    async disconnectHub() {
      link = HUB_LINK_NONE;
      announce();
    },
    reportLink(state) {
      link = state;
      announce();
    },
    async register(machineId, hello) {
      const status = hello.protocolVersion === PROTOCOL_VERSION ? "online" : "update-required";
      return set({ id: machineId, ...hello, status, lastSeenAt: now() });
    },
    heartbeat(machineId, threadCount) {
      const machine = machines.get(machineId);
      if (!machine) return;
      machines.set(machineId, {
        ...machine,
        lastSeenAt: now(),
        threadCount: threadCount ?? machine.threadCount,
      });
    },
    markOffline(machineId) {
      const machine = machines.get(machineId);
      if (machine && machine.status !== "offline") set({ ...machine, status: "offline", lastSeenAt: now() });
    },
    async readSummary(machineId) {
      return summaries.get(machineId);
    },
    async writeSummary(machineId, summary) {
      require(machineId);
      summaries.set(machineId, summary);
    },
  };
  return {
    api,
    setStatus(machineId, status) {
      set({ ...require(machineId), status, lastSeenAt: now() });
    },
  };
}
