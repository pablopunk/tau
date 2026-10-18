import type { ClaudeMcpServerStatus } from "../sdk-types";
import { isConnected, LINEAR_SERVER, waitForConnectors } from "./connector-harness";
import type { PinContext } from "./pin-context";

const READ_ONLY_PROBE_SERVERS = [LINEAR_SERVER, "claude.ai Slack"];

const readOnlyNames = (server: ClaudeMcpServerStatus) =>
  server.tools.filter((tool) => tool.readOnly).map((tool) => tool.name);

const countByStatus = (servers: readonly ClaudeMcpServerStatus[]) => {
  const counts: Record<string, number> = {};
  for (const server of servers) counts[server.status] = (counts[server.status] ?? 0) + 1;
  return JSON.stringify(counts);
};

async function probePin(ctx: PinContext): Promise<readonly ClaudeMcpServerStatus[]> {
  const probe = ctx.port.startProbe();
  let servers: readonly ClaudeMcpServerStatus[] = [];
  try {
    await ctx.report.run("q", "a probe query returns mcpServerStatus() with no model turn", async () => {
      const waited = await waitForConnectors(probe);
      servers = waited.servers;
      if (servers.length === 0) throw new Error("the probe listed no servers");
      if (servers.some((server) => server.status === "pending"))
        throw new Error("servers still pending after the cap");
      return `${servers.length} servers (${countByStatus(servers)}) all settled after ${waited.waitedMs} ms; 0 model turns`;
    });
  } finally {
    probe.close();
  }
  return servers;
}

function readOnlyPin(ctx: PinContext, servers: readonly ClaudeMcpServerStatus[]) {
  return ctx.report.run(
    "r",
    "tools[].annotations.readOnly is set for Linear and Slack read tools",
    async () => {
      const evidence = READ_ONLY_PROBE_SERVERS.map((name) => {
        const server = servers.find((row) => row.name === name && isConnected(row));
        if (!server) throw new Error(`${name} is not connected`);
        const reads = readOnlyNames(server);
        if (reads.length === 0) throw new Error(`${name} has no readOnly tool`);
        return `${name}: ${reads.length} of ${server.tools.length} tools readOnly, e.g. ${reads.slice(0, 3).join(", ")}`;
      });
      return evidence.join("; ");
    },
  );
}

export async function runGatePins(ctx: PinContext): Promise<void> {
  const servers = await probePin(ctx);
  await readOnlyPin(ctx, servers);
}
