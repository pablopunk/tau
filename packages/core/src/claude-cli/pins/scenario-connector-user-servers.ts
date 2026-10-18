import { waitForConnectors } from "./connector-harness";
import type { PinContext } from "./pin-context";

async function observe(ctx: PinContext, settingSources: readonly string[]) {
  const probe = ctx.port.startProbe({ settingSources });
  try {
    const { servers } = await waitForConnectors(probe);
    const context = await probe.contextSummary();
    const userServers = servers.filter((server) => server.source !== "claudeai");
    return {
      userServers: userServers.map((server) => `${server.name}/${server.source}/${server.status}`),
      memoryFileCount: context.memoryFileCount,
    };
  } finally {
    probe.close();
  }
}

export async function runUserServerPin(ctx: PinContext): Promise<void> {
  await ctx.report.run("m", "user-scope claude mcp servers load without hooks or CLAUDE.md", async () => {
    const without = await observe(ctx, []);
    const withUser = await observe(ctx, ["user"]);
    const evidence = `settingSources [] : non-connector servers ${JSON.stringify(without.userServers)}, memory files ${without.memoryFileCount}; settingSources ["user"] : non-connector servers ${JSON.stringify(withUser.userServers)}, memory files ${withUser.memoryFileCount}`;
    if (withUser.memoryFileCount > without.memoryFileCount)
      throw new Error(
        `settingSources ["user"] also loads CLAUDE.md memory (and the user settings hooks). ${evidence}`,
      );
    return evidence;
  });
}
