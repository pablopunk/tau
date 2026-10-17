import { notImplemented } from "../not-implemented";

export const GENERAL_PURPOSE = "general-purpose";

export type AgentTypeSource = "project-pi" | "project-claude" | "user-pi" | "user-claude" | "built-in";

export interface AgentType {
  readonly name: string;
  readonly description: string;
  readonly source: AgentTypeSource;
  /** Pi tool names after the Claude mapping; `undefined` means every tool the child may have. */
  readonly tools: readonly string[] | undefined;
  readonly disallowedTools: readonly string[];
  readonly model: string | undefined;
  readonly prompt: string;
  /** Set for a type whose tool list maps to nothing: shown in `list_agents`, rejected on use. */
  readonly error?: string;
}

export interface AgentTypeLoader {
  /** Project types win over user types; `.pi` wins over `.claude`. Always contains `general-purpose`. Cached 30 s. */
  load(projectPath: string): Promise<readonly AgentType[]>;
  clearCache(): void;
}

export function createAgentTypeLoader(): AgentTypeLoader {
  return {
    load: async () => {
      throw notImplemented("agent types loader");
    },
    clearCache() {},
  };
}
