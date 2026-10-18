import { GOAL_CONDITION_MAX_LENGTH, type Goal, type GoalState } from "@tau/protocol";

const CLEAR_WORDS = ["clear", "stop", "off", "reset", "none", "cancel"];

export type GoalArgs =
  | { readonly kind: "status" }
  | { readonly kind: "clear" }
  | { readonly kind: "set"; readonly condition: string };

/** `/goal` shows the status, `/goal clear` (or `stop`, `off`, `reset`, `none`, `cancel`) clears, anything else sets. */
export function parseGoalArgs(args: string): GoalArgs {
  const text = args.trim();
  if (text === "") return { kind: "status" };
  if (CLEAR_WORDS.includes(text.toLowerCase())) return { kind: "clear" };
  return { kind: "set", condition: text };
}

export const conditionTooLong = (condition: string) => condition.length > GOAL_CONDITION_MAX_LENGTH;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function formatElapsed(ms: number): string {
  const elapsed = Math.max(0, ms);
  if (elapsed < MINUTE) return `${Math.floor(elapsed / 1000)}s`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  const hours = Math.floor(elapsed / HOUR);
  return `${hours}h ${Math.floor((elapsed % HOUR) / MINUTE)}m`;
}

export const formatTokens = (tokens: number): string =>
  tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`;

export const stateLabel = (state: GoalState): string => (state === "cleared" ? "cleared" : state);

export interface GoalStatusField {
  readonly label: string;
  readonly value: string;
}

export function goalStatusFields(goal: Goal, now: number): GoalStatusField[] {
  return [
    { label: "Condition", value: goal.condition },
    { label: "State", value: stateLabel(goal.state) },
    { label: "Elapsed", value: formatElapsed(now - goal.startedAt) },
    { label: "Turns evaluated", value: String(goal.turnsEvaluated) },
    { label: "Tokens", value: formatTokens(goal.tokensSpent) },
    { label: "Last reason", value: goal.lastReason ?? "none yet" },
  ];
}

export const goalStatusText = (goal: Goal, now: number): string =>
  goalStatusFields(goal, now)
    .map(({ label, value }) => `${label}: ${value}`)
    .join("\n");
