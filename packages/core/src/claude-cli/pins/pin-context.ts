import type { ClaudeQueryOptions, ClaudeSdkPort, ClaudeToolHost } from "../sdk-types";
import type { PinReport } from "./pin-report";

export const PIN_MODEL = "haiku";
export const MAX_PIN_TURNS = 6;
const PIN_SYSTEM_PROMPT = "You are a test agent. Use the tools when asked. Be terse.";
const REMOVED_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL"];

export interface TurnBudget {
  /** Every message sent to the model goes through here. */
  spend(label: string): void;
  readonly spent: () => string[];
}

export function createTurnBudget(max: number): TurnBudget {
  const labels: string[] = [];
  return {
    spend(label) {
      if (labels.length >= max) throw new Error(`Turn budget of ${max} is spent; refused "${label}".`);
      labels.push(label);
    },
    spent: () => [...labels],
  };
}

export interface PinContext {
  readonly port: ClaudeSdkPort;
  readonly report: PinReport;
  readonly budget: TurnBudget;
  readonly cwd: string;
  readonly createdSessions: Set<string>;
}

const pinEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !REMOVED_VARIABLES.includes(name)));

export function pinOptions(
  cwd: string,
  prompt: ClaudeQueryOptions["prompt"],
  toolHost: ClaudeToolHost,
  overrides: Partial<ClaudeQueryOptions> = {},
): ClaudeQueryOptions {
  return {
    prompt,
    model: PIN_MODEL,
    cwd,
    systemPrompt: PIN_SYSTEM_PROMPT,
    env: pinEnv(),
    title: "tau-pin (safe to delete)",
    tools: [],
    strictMcpConfig: true,
    settingSources: [],
    settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
    permissionMode: "dontAsk",
    allowedTools: ["mcp__tau__*"],
    includePartialMessages: true,
    toolHost,
    ...overrides,
  };
}
