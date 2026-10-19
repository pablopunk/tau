import { isConnected, waitForConnectors } from "./connector-harness";
import type { PinContext } from "./pin-context";

/** MCP tokens that may sit in the window with every connector on and tool search enabled. */
export const MCP_WINDOW_BUDGET_TOKENS = 15_000;

/** A model-free pin: the probe uses the options of a thread with connectors (`tools: ["ToolSearch"]`). */
export async function toolSearchBudgetPin(ctx: PinContext): Promise<void> {
  await ctx.report.run(
    "t",
    "with every connector on, tool search keeps MCP tokens in the window small",
    async () => {
      const probe = ctx.port.startProbe();
      try {
        const { servers } = await waitForConnectors(probe);
        const connected = servers.filter((server) => server.source !== "sdk" && isConnected(server));
        const toolCount = connected.reduce((sum, server) => sum + server.tools.length, 0);
        if (toolCount === 0) return "no connected connector with tools on this account: nothing to measure";
        const summary = await probe.contextSummary();
        const evidence = `${connected.length} connectors, ${toolCount} tools: ${summary.mcpTokens} MCP tokens in the window, ${summary.deferredMcpTokens} deferred, ${summary.totalTokens} total`;
        if (summary.deferredMcpTokens === 0)
          throw new Error(
            `no "MCP tools (deferred)" row: tool search is off (ENABLE_TOOL_SEARCH, ANTHROPIC_BASE_URL or disabled betas?). ${evidence}`,
          );
        if (summary.mcpTokens >= MCP_WINDOW_BUDGET_TOKENS)
          throw new Error(`MCP tokens in the window exceed ${MCP_WINDOW_BUDGET_TOKENS}. ${evidence}`);
        return evidence;
      } finally {
        probe.close();
      }
    },
  );
}
