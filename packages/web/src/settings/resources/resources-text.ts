import type { ResourceScope } from "@tau/protocol";

export const NEW_COMMANDS_ONLY = "Applies to new commands only.";
export const NEEDS_UPDATE = "This node needs an update";
export const MEMORY_CAP_NOTE = "Every capped command gets the same memory cap, sized for this host.";

export const SCOPES: { key: ResourceScope; rowId: string; label: string }[] = [
  {
    key: "main",
    rowId: "resources-levels-main",
    label: "Main threads",
  },
  {
    key: "worktree",
    rowId: "resources-levels-worktree",
    label: "Worktree threads",
  },
  {
    key: "subagent",
    rowId: "resources-levels-subagent",
    label: "Subagents",
  },
];
