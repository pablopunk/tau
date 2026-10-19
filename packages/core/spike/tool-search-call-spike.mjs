// Throwaway spike: a real read-only connector call discovered through ToolSearch, gated like tau does.
const { query } = await import(process.argv[2]);
const { tmpdir } = await import("node:os");
const API = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !API.includes(k)));
const asked = [];
let go; const gate = new Promise((r) => (go = r));
const text = "Use the claude.ai Context7 connector resolve-library-id tool for react (find it with tool search). Be brief.";
const prompt = (async function* () { await gate; yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null }; })();
const q = query({ prompt,
  options: { cwd: tmpdir(), settingSources: [], strictMcpConfig: false, tools: ["ToolSearch"], model: "sonnet", maxTurns: 6, persistSession: false,
    settings: { disableClaudeAiConnectors: false, autoCompactEnabled: false }, permissionMode: "default",
    allowedTools: ["mcp__claude_ai_Context7__resolve-library-id"], disallowedTools: ["mcp__claude_ai_Notion__*"], env,
    canUseTool: async (toolName, input, o) => { asked.push(toolName); return { behavior: "deny", message: "spike: not allowed" }; } } });
// like tau: let connectors settle before the first turn
q.supportedModels().then(async () => { let st = []; for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 1000)); st = await q.mcpServerStatus(); if (st.length && !st.some((s) => s.status === "pending")) break; } go(); });
for await (const m of q) {
  if (m.type === "assistant") for (const b of m.message.content) if (b.type === "tool_use") console.log("tool_use", b.name, JSON.stringify(b.input).slice(0, 120));
  if (m.type === "user") for (const b of m.message.content ?? []) if (b?.type === "tool_result") console.log("tool_result", JSON.stringify(b.content).slice(0, 200));
  if (m.type === "result") console.log("result", m.subtype, (m.result ?? "").slice(0, 200));
}
console.log("canUseTool asked for:", asked);
process.exit(0);
