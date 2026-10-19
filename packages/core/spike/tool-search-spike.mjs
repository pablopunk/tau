// Throwaway spike: does tool search defer claude.ai connector schemas under tau's query options?
// usage: node tool-search-spike.mjs <sdk-entry.mjs>
import { tmpdir } from "node:os";
const { query } = await import(process.argv[2]);
const API = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !API.includes(k)));
const variants = {
  "a tools:[] (tau today)": { tools: [] },
  "b tools:[ToolSearch]": { tools: ["ToolSearch"] },
  "c tools:[] allowedTools+ToolSearch": { tools: [], allowedTools: ["ToolSearch"] },
  "d tools:[] ENABLE_TOOL_SEARCH=auto:1": { tools: [], env: { ENABLE_TOOL_SEARCH: "auto:1" } },
  "e tools:[ToolSearch] ENABLE_TOOL_SEARCH=auto:1": { tools: ["ToolSearch"], env: { ENABLE_TOOL_SEARCH: "auto:1" } },
  "f tools:[ToolSearch] ENABLE_TOOL_SEARCH=false": { tools: ["ToolSearch"], env: { ENABLE_TOOL_SEARCH: "false" } },
};
for (const [name, extra] of Object.entries(variants)) {
  let release;
  const never = (async function* () { await new Promise((r) => (release = r)); })();
  const q = query({ prompt: never, options: { cwd: tmpdir(), settingSources: [], strictMcpConfig: false,
    settings: { disableClaudeAiConnectors: false, autoCompactEnabled: false }, permissionMode: "dontAsk",
    ...extra, env: { ...baseEnv, ...(extra.env ?? {}) } } });
  let st = [];
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 1000)); st = await q.mcpServerStatus();
    if (st.length && !st.some((s) => s.status === "pending")) break; }
  const u = await q.getContextUsage();
  const connected = st.filter((s) => s.status === "connected").length;
  const loaded = u.mcpTools.filter((t) => t.isLoaded !== false), deferred = u.mcpTools.filter((t) => t.isLoaded === false);
  const sum = (a) => a.reduce((n, t) => n + (t.tokens ?? 0), 0);
  const deferredCat = u.categories?.filter((c) => /defer|mcp|tool/i.test(c.name)).map((c) => `${c.name}=${c.tokens}`);
  console.log(name, JSON.stringify({ servers: st.length, connected, loaded: loaded.length, loadedTokens: sum(loaded), deferred: deferred.length, deferredTokens: sum(deferred), total: u.totalTokens, deferredCat }));
  release(); q.close(); }
process.exit(0);
