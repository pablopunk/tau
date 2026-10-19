import type { ConversationSummary, Core, MachineSummary, Project } from "@tau/protocol";
import type { MachineGateway } from "./gateway";

const TICK_MS = 2000;
const WRITE_EVERY_MS = 15_000;
const HUB_LABEL = "hub-summary";

async function fetchJson<T>(gateway: MachineGateway, machineId: string, path: string): Promise<T> {
  const response = await gateway.request(machineId, {
    method: "GET",
    path,
    query: "",
    hubDevice: HUB_LABEL,
  });
  if (response.status !== 200) throw new Error(`${path}: ${response.status}`);
  return JSON.parse(response.body.toString("utf8")) as T;
}

/** Titles and times only: what the hub shows for a machine that went offline. */
export async function summaryOf(gateway: MachineGateway, machineId: string): Promise<MachineSummary> {
  const [projects, conversations] = await Promise.all([
    fetchJson<Project[]>(gateway, machineId, "/api/projects"),
    fetchJson<ConversationSummary[]>(gateway, machineId, "/api/conversations"),
  ]);
  return {
    savedAt: Date.now(),
    projects: projects.map(({ id, name }) => ({ id, name })),
    threads: conversations
      .filter((thread) => thread.archivedAt === null)
      .map(({ id, projectId, title, updatedAt }) => ({ id, projectId, title, updatedAt })),
  };
}

/** While a machine is online the hub saves its summary through the link: at once, then at most every 15 s. */
export function startSummaryWriter(core: Core, gateway: MachineGateway): () => void {
  const lastWrite = new Map<string, number>();
  let running = false;
  const writeOne = async (machineId: string) => {
    lastWrite.set(machineId, Date.now());
    try {
      const summary = await summaryOf(gateway, machineId);
      await core.machines.writeSummary(machineId, summary);
      core.machines.heartbeat(machineId, summary.threads.length);
    } catch {
      // The machine went away or answered badly: the previous summary stays.
    }
  };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const machines = await core.machines.list();
      const due = machines.filter(
        (machine) =>
          machine.status === "online" &&
          gateway.isOnline(machine.id) &&
          Date.now() - (lastWrite.get(machine.id) ?? 0) >= WRITE_EVERY_MS,
      );
      await Promise.all(due.map((machine) => writeOne(machine.id)));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
