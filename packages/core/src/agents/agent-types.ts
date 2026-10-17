import { homedir } from "node:os";
import { join } from "node:path";
import { FORK, FORK_TYPE, GENERAL_PURPOSE_TYPE } from "./built-in-types";
import { readAgentDir } from "./read-agent-dir";

export { GENERAL_PURPOSE } from "./built-in-types";

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

export interface AgentTypeLoaderOptions {
  readonly home?: string;
  readonly now?: () => number;
}

const CACHE_MS = 30_000;

function searchDirs(projectPath: string, home: string): readonly (readonly [string, AgentTypeSource])[] {
  return [
    [join(projectPath, ".pi", "agents"), "project-pi"],
    [join(projectPath, ".claude", "agents"), "project-claude"],
    [join(home, ".pi", "agent", "agents"), "user-pi"],
    [join(home, ".claude", "agents"), "user-claude"],
  ];
}

function firstByName(types: readonly AgentType[]): readonly AgentType[] {
  const seen = new Map<string, AgentType>();
  for (const type of types) if (!seen.has(type.name) && type.name !== FORK) seen.set(type.name, type);
  return [...seen.values()];
}

async function loadAll(projectPath: string, home: string): Promise<readonly AgentType[]> {
  const groups = await Promise.all(
    searchDirs(projectPath, home).map(([dir, source]) => readAgentDir(dir, source)),
  );
  return [...firstByName([...groups.flat(), GENERAL_PURPOSE_TYPE]), FORK_TYPE];
}

export function createAgentTypeLoader(options: AgentTypeLoaderOptions = {}): AgentTypeLoader {
  const home = options.home ?? homedir();
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; types: Promise<readonly AgentType[]> }>();
  return {
    load(projectPath) {
      const hit = cache.get(projectPath);
      if (hit && now() - hit.at < CACHE_MS) return hit.types;
      const types = loadAll(projectPath, home);
      cache.set(projectPath, { at: now(), types });
      types.catch(() => cache.delete(projectPath));
      return types;
    },
    clearCache() {
      cache.clear();
    },
  };
}
