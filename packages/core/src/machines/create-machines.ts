import {
  AppError,
  type Core,
  HUB_LINK_NONE,
  type HubLink,
  type Machine,
  type MachineHello,
} from "@tau/protocol";
import type { MachinesDeps } from "./ports";
import { deriveStatus } from "./status";
import { createSummaryStore } from "./summary-store";

interface Entry {
  hello: MachineHello;
  lastSeenAt: number;
  closed: boolean;
}

export type MachinesService = Core["machines"] & {
  /** Forgets every machine and its summary (remote disable or recreate clears the devices too). */
  reset(): Promise<void>;
};

/** `Core.machines`: an in-memory registry fed by the link, over machine devices of the access store. */
export function createMachines(deps: MachinesDeps): MachinesService {
  let link: HubLink = HUB_LINK_NONE;
  const entries = new Map<string, Entry>();
  const summaries = createSummaryStore(deps.directory);
  const announce = () => deps.changes.emit({ resource: "machines" });

  async function machineDevices() {
    return (await deps.access.listDevices("")).filter((device) => device.kind === "machine");
  }
  function toMachine(id: string, name: string, entry: Entry | undefined, deviceSeenAt: number): Machine {
    if (!entry) {
      return {
        id,
        name,
        os: "",
        tauVersion: "",
        protocolVersion: "",
        status: "offline",
        lastSeenAt: deviceSeenAt,
        threadCount: 0,
      };
    }
    const { hello } = entry;
    const status = deriveStatus(
      {
        lastSeenAt: entry.lastSeenAt,
        closed: entry.closed,
        protocolMismatch: hello.protocolVersion !== deps.protocolVersion,
      },
      deps.now(),
    );
    return {
      id,
      name,
      os: hello.os,
      tauVersion: hello.tauVersion,
      protocolVersion: hello.protocolVersion,
      status,
      lastSeenAt: entry.lastSeenAt,
      threadCount: hello.threadCount,
      ...(link.state !== "none" && link.hubName ? { linkedTo: link.hubName } : {}),
    };
  }
  async function find(id: string): Promise<Machine | undefined> {
    return (await api.list()).find((machine) => machine.id === id);
  }
  const api: MachinesService = {
    async list() {
      const devices = await machineDevices();
      const ids = new Set(devices.map((device) => device.id));
      for (const id of entries.keys()) if (!ids.has(id)) entries.delete(id);
      return devices.map((d) => toMachine(d.id, d.name, entries.get(d.id), d.lastSeenAt));
    },
    async rename(id, name) {
      if (!(await find(id))) throw new AppError("not_found", `No machine ${id}.`);
      await deps.access.renameDevice(id, name);
      announce();
    },
    async disconnect(id) {
      entries.delete(id);
      await summaries.remove(id);
      await deps.access.revokeDevice(id);
      announce();
    },
    hubState: async () => ({ ...link, os: `${process.platform} ${process.arch}` }),
    async disconnectHub() {
      await deps.forgetHub?.();
      link = HUB_LINK_NONE;
      announce();
    },
    reportLink(state) {
      link = state;
      announce();
    },
    async register(machineId, hello) {
      const device = (await machineDevices()).find((entry) => entry.id === machineId);
      if (!device) throw new AppError("not_found", `No machine ${machineId}.`);
      entries.set(machineId, { hello, lastSeenAt: deps.now(), closed: false });
      announce();
      return toMachine(machineId, device.name, entries.get(machineId), device.lastSeenAt);
    },
    heartbeat(machineId, threadCount) {
      const entry = entries.get(machineId);
      if (!entry) return;
      const before = deriveStatus(
        { lastSeenAt: entry.lastSeenAt, closed: entry.closed, protocolMismatch: false },
        deps.now(),
      );
      entry.lastSeenAt = deps.now();
      entry.closed = false;
      const count = threadCount ?? entry.hello.threadCount;
      const changed = entry.hello.threadCount !== count || before !== "online";
      entry.hello = { ...entry.hello, threadCount: count };
      if (changed) announce();
    },
    markOffline(machineId) {
      const entry = entries.get(machineId);
      if (!entry) return;
      entry.closed = true;
      entry.lastSeenAt = deps.now();
      void summaries.markStale(machineId).catch(() => undefined);
      announce();
    },
    readSummary: (machineId) => summaries.read(machineId),
    async writeSummary(machineId, summary) {
      const entry = entries.get(machineId);
      if (!entry || entry.closed || entry.hello.protocolVersion !== deps.protocolVersion) return;
      if (
        deriveStatus({ lastSeenAt: entry.lastSeenAt, closed: false, protocolMismatch: false }, deps.now()) !==
        "online"
      )
        return;
      await summaries.write(machineId, summary);
    },
    async reset() {
      entries.clear();
      await summaries.removeAll();
      announce();
    },
  };
  return api;
}
