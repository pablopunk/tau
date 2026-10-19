import type { ConversationSummary, Core, NodeSummary, Project } from "@tau/protocol";
import type { NodeGateway } from "./gateway";

const TICK_MS = 2000;
const WRITE_EVERY_MS = 15_000;
const SUMMARY_LABEL = "node-summary";

async function fetchJson<T>(gateway: NodeGateway, nodeId: string, path: string): Promise<T> {
  const response = await gateway.request(nodeId, {
    method: "GET",
    path,
    query: "",
    via: SUMMARY_LABEL,
  });
  if (response.status !== 200) throw new Error(`${path}: ${response.status}`);
  return JSON.parse(response.body.toString("utf8")) as T;
}

/** Titles and times only: what the hub shows for a node that went offline. */
export async function summaryOf(gateway: NodeGateway, nodeId: string): Promise<NodeSummary> {
  const [projects, conversations] = await Promise.all([
    fetchJson<Project[]>(gateway, nodeId, "/api/projects"),
    fetchJson<ConversationSummary[]>(gateway, nodeId, "/api/conversations"),
  ]);
  return {
    savedAt: Date.now(),
    projects: projects.map(({ id, name }) => ({ id, name })),
    threads: conversations
      .filter((thread) => thread.archivedAt === null)
      .map(({ id, projectId, title, updatedAt }) => ({ id, projectId, title, updatedAt })),
  };
}

/** While a node is online the hub saves its summary through the link: at once, then at most every 15 s. */
export function startSummaryWriter(core: Core, gateway: NodeGateway): () => void {
  const lastWrite = new Map<string, number>();
  let running = false;
  const writeOne = async (nodeId: string) => {
    lastWrite.set(nodeId, Date.now());
    try {
      const summary = await summaryOf(gateway, nodeId);
      await core.nodes.writeSummary(nodeId, summary);
      core.nodes.heartbeat(nodeId, summary.threads.length);
    } catch {
      // The node went away or answered badly: the previous summary stays.
    }
  };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const nodes = await core.nodes.list();
      const due = nodes.filter(
        (node) =>
          node.status === "online" &&
          gateway.isOnline(node.id) &&
          Date.now() - (lastWrite.get(node.id) ?? 0) >= WRITE_EVERY_MS,
      );
      await Promise.all(due.map((node) => writeOne(node.id)));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
