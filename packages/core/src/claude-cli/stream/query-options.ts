import type { ClaudeEffort, ClaudeInputStream, ClaudeQueryOptions, ClaudeToolHost } from "../sdk-types";
import { TOOL_NAME_PREFIX } from "../tool-server";

const API_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

export const withoutApiKeys = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !API_KEY_VARIABLES.includes(name)));

export interface QueryOptionsInput {
  readonly prompt: ClaudeInputStream | string;
  readonly model: string;
  readonly cwd: string;
  readonly systemPrompt: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly title: string;
  readonly effort?: ClaudeEffort;
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly forkSession?: boolean;
  readonly persistSession?: boolean;
  readonly maxTurns?: number;
  readonly toolHost?: ClaudeToolHost;
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

/** The options every query gets, whatever the path. */
export function buildQueryOptions(input: QueryOptionsInput): ClaudeQueryOptions {
  return {
    prompt: input.prompt,
    model: input.model,
    cwd: input.cwd,
    systemPrompt: input.systemPrompt,
    env: withoutApiKeys(input.env),
    title: input.title,
    tools: [],
    strictMcpConfig: true,
    settingSources: [],
    settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
    permissionMode: "dontAsk",
    allowedTools: input.toolHost ? [`${TOOL_NAME_PREFIX}*`] : [],
    includePartialMessages: true,
    ...optional("effort", input.effort),
    ...optional("resume", input.resume),
    ...optional("resumeSessionAt", input.resumeSessionAt),
    ...optional("forkSession", input.forkSession),
    ...optional("persistSession", input.persistSession),
    ...optional("maxTurns", input.maxTurns),
    ...optional("toolHost", input.toolHost),
  };
}

type Reasoning = string | undefined;

/** `minimal` is `low`; no reasoning means no effort option. */
export function effortOf(reasoning: Reasoning): ClaudeEffort | undefined {
  if (reasoning === "minimal") return "low";
  if (reasoning === "low" || reasoning === "medium" || reasoning === "high" || reasoning === "xhigh") {
    return reasoning;
  }
  return undefined;
}
