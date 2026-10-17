const MCP_TOOLS = ["mcp_search", "mcp_call"];

const CLAUDE_TO_PI: Readonly<Record<string, readonly string[]>> = {
  read: ["read"],
  write: ["write"],
  edit: ["edit"],
  multiedit: ["edit"],
  bash: ["bash"],
  grep: ["bash"],
  glob: ["bash"],
  websearch: ["web_search"],
  webfetch: ["fetch_content"],
  todowrite: ["todo_write"],
};

const LOSSY_SEARCH_TOOLS = new Set(["grep", "glob"]);

export function mapClaudeTool(name: string): readonly string[] {
  const key = name.trim().toLowerCase();
  if (key.startsWith("mcp__")) return MCP_TOOLS;
  return CLAUDE_TO_PI[key] ?? [];
}

const unique = (names: readonly string[]) => [...new Set(names)];

export function mapClaudeTools(names: readonly string[]): readonly string[] {
  return unique(names.flatMap(mapClaudeTool));
}

export function mapDisallowedTools(names: readonly string[]): readonly string[] {
  return mapClaudeTools(names.filter((name) => !LOSSY_SEARCH_TOOLS.has(name.trim().toLowerCase())));
}
