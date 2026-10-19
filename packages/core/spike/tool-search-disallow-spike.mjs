// Throwaway spike: do disallowedTools globs remove a server's tools from the deferred list?
const { query } = await import(process.argv[2]);
const { tmpdir } = await import("node:os");
for (const disallowedTools of [[], ["mcp__claude_ai_DataDog__*", "mcp__claude_ai_Incident_io__*"]]) {
  let r; const never = (async function* () { await new Promise((x) => (r = x)); })();
  const q = query({ prompt: never, options: { cwd: tmpdir(), settingSources: [], tools: ["ToolSearch"], strictMcpConfig: false, disallowedTools, settings: { disableClaudeAiConnectors: false } } });
  let st = []; for (let i = 0; i < 30; i++) { await new Promise((x) => setTimeout(x, 1000)); st = await q.mcpServerStatus(); if (st.length && !st.some((s) => s.status === "pending")) break; }
  const u = await q.getContextUsage();
  console.log(JSON.stringify(disallowedTools), "mcpTools", u.mcpTools.length, "total", u.totalTokens, u.categories.filter((c) => /MCP/.test(c.name)).map((c) => `${c.name}=${c.tokens}`));
  r(); q.close();
}
process.exit(0);
