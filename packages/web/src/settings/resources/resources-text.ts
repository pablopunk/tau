import type { ResourceScope, ResourceSettings } from "@tau/protocol";

export const NEW_COMMANDS_ONLY = "Applies to new commands only.";
export const NEEDS_UPDATE = "This node needs an update";
export const MEMORY_CAP_NOTE = "Every capped command gets the same memory cap, sized from this machine's RAM.";

export const isControlOn = (value: ResourceSettings): boolean =>
  value.levels.main !== "off" || value.levels.worktree !== "off" || value.levels.subagent !== "off";

export const SCOPES: { key: ResourceScope; rowId: string; label: string; blurb: string }[] = [
  {
    key: "main",
    rowId: "resources-levels-main",
    label: "Main threads",
    blurb: "The thread in the main checkout.",
  },
  {
    key: "worktree",
    rowId: "resources-levels-worktree",
    label: "Worktree threads",
    blurb: "Threads working in worktrees.",
  },
  {
    key: "subagent",
    rowId: "resources-levels-subagent",
    label: "Subagents",
    blurb: "Subagents spawned by any thread.",
  },
];

export const LEVEL_HINT: Record<string, string> = {
  off: "Runs at full speed.",
  balanced: "Lower CPU priority.",
  background: "Lowest CPU priority; commands take longer.",
};
