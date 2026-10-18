export const SUBAGENT_TOOL_NAMES: readonly string[] = [
  "agent",
  "send_message",
  "stop_agent",
  "list_agents",
  "merge_agent",
];

/** Timers belong to the parent thread; a subagent never gets them (MVP8.md section 4). */
export const TIMER_TOOL_NAMES: readonly string[] = [
  "schedule_wakeup",
  "schedule_repeat",
  "timers_list",
  "timer_delete",
];

export const isSubagentTool = (name: string) =>
  SUBAGENT_TOOL_NAMES.includes(name) || TIMER_TOOL_NAMES.includes(name);
