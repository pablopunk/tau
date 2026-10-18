import type { AgentType } from "./agent-types";

export const GENERAL_PURPOSE = "general-purpose";
export const FORK = "fork";

const builtIn = (name: string, description: string): AgentType => ({
  name,
  description,
  source: "built-in",
  tools: undefined,
  disallowedTools: [],
  model: undefined,
  thinking: undefined,
  prompt: "",
});

export const GENERAL_PURPOSE_TYPE = builtIn(
  GENERAL_PURPOSE,
  "General-purpose agent with every tool except the subagent tools.",
);

export const FORK_TYPE = builtIn(
  FORK,
  "Inherits this whole conversation, then works on the prompt as its next message.",
);
