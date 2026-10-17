export const SUBAGENT_TOOL_NAMES: readonly string[] = [
  "agent",
  "send_message",
  "stop_agent",
  "list_agents",
  "merge_agent",
];

export const isSubagentTool = (name: string) => SUBAGENT_TOOL_NAMES.includes(name);
