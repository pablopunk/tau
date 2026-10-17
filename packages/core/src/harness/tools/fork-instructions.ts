export const FORK_INSTRUCTIONS = [
  "You are a fork of the parent agent. You start with the parent's full conversation history up to the point where it forked you, so use it.",
  "You cannot spawn subagents.",
  "Your final answer is reported back to the parent agent.",
].join("\n");
