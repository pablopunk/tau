import type {
  ClaudeCanUseTool,
  ClaudeEffort,
  ClaudeInputStream,
  ClaudeQueryOptions,
  ClaudeReasoning,
  ClaudeToolHost,
} from "../sdk-types";
import { TOOL_NAME_PREFIX } from "../tool-server";

const API_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

export const withoutApiKeys = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !API_KEY_VARIABLES.includes(name)));

/** What a query with at least one chosen connector adds. */
export interface ConnectorQueryInput {
  readonly allowedTools: readonly string[];
  readonly disallowedTools: readonly string[];
  readonly canUseTool: ClaudeCanUseTool;
}

export interface QueryOptionsInput {
  readonly prompt: ClaudeInputStream | string;
  readonly model: string;
  readonly cwd: string;
  readonly systemPrompt: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly title: string;
  readonly reasoning?: ClaudeReasoning;
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly forkSession?: boolean;
  readonly persistSession?: boolean;
  readonly maxTurns?: number;
  readonly toolHost?: ClaudeToolHost;
  readonly connectors?: ConnectorQueryInput;
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

const lockedDownOptions = (tauTools: readonly string[]) =>
  ({
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
    permissionMode: "dontAsk",
    allowedTools: tauTools,
  }) as const;

const connectorOptions = (tauTools: readonly string[], connectors: ConnectorQueryInput) => ({
  strictMcpConfig: false,
  settings: { disableClaudeAiConnectors: false, autoCompactEnabled: false },
  permissionMode: "default" as const,
  allowedTools: [...new Set([...tauTools, ...connectors.allowedTools])],
  canUseTool: connectors.canUseTool,
  ...(connectors.disallowedTools.length > 0 && { disallowedTools: connectors.disallowedTools }),
});

const reasoningOptions = (
  reasoning: ClaudeReasoning | undefined,
): Pick<ClaudeQueryOptions, "effort" | "thinking"> => {
  if (reasoning === "off") return { thinking: { type: "disabled" } };
  return reasoning ? { effort: reasoning } : {};
};

/** The options every query gets, whatever the path. Connectors loosen the MCP lock only when chosen. */
export function buildQueryOptions(input: QueryOptionsInput): ClaudeQueryOptions {
  const tauTools = input.toolHost ? [`${TOOL_NAME_PREFIX}*`] : [];
  return {
    prompt: input.prompt,
    model: input.model,
    cwd: input.cwd,
    systemPrompt: input.systemPrompt,
    env: withoutApiKeys(input.env),
    title: input.title,
    tools: [],
    settingSources: [],
    includePartialMessages: true,
    ...(input.connectors ? connectorOptions(tauTools, input.connectors) : lockedDownOptions(tauTools)),
    ...reasoningOptions(input.reasoning),
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
