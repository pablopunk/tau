import type { NativeEvent } from "./events";
import { ASK_USER_QUESTION_TOOL, denyEverything, type NativeCanUseTool } from "./permissions";

export type OptionsContext = { readonly threadId: string; readonly cwd: string };

export type NativeSettingSource = "user" | "project" | "local";

export const DEFAULT_SETTING_SOURCES: readonly NativeSettingSource[] = ["user", "project", "local"];

export const TAU_INSTRUCTIONS = [
  "You are running inside Tau, a browser app where the user chats with you about this project folder.",
  "Tool calls that change anything wait for the user's approval in Tau, and the user can deny them.",
  "You cannot show the user a question dialog: ask questions in plain text in your reply.",
].join(" ");

export interface NativeOptionsInput extends OptionsContext {
  readonly settingSources?: readonly NativeSettingSource[];
  readonly canUseTool?: NativeCanUseTool;
}

const MAX_LISTED_NAMES = 20;
const MAX_NAME_LENGTH = 60;

export function buildNativeOptions(input: NativeOptionsInput): Record<string, unknown> {
  return {
    cwd: input.cwd,
    tools: { type: "preset", preset: "claude_code" },
    systemPrompt: { type: "preset", preset: "claude_code", append: TAU_INSTRUCTIONS },
    settingSources: [...(input.settingSources ?? DEFAULT_SETTING_SOURCES)],
    permissionMode: "default",
    disallowedTools: [ASK_USER_QUESTION_TOOL],
    canUseTool: input.canUseTool ?? denyEverything,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInitMessage = (message: unknown): message is Record<string, unknown> =>
  isRecord(message) && message.type === "system" && message.subtype === "init";

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const pluginNamesOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => (isRecord(item) && typeof item.name === "string" ? [item.name] : []))
    : [];

const boundedNames = (names: readonly string[]): string => {
  const shown = names.slice(0, MAX_LISTED_NAMES).map((name) => name.slice(0, MAX_NAME_LENGTH));
  const more = names.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
};

const countedList = (label: string, names: readonly string[]): string =>
  names.length === 0 ? `${label}: none.` : `${label} (${names.length}): ${boundedNames(names)}.`;

export function sourcesOf(options: Record<string, unknown>): readonly string[] {
  return stringsOf(options.settingSources);
}

/** Names and counts only: never the content of a settings file, rule, skill or hook. */
export function settingSourcesNotice(
  operationId: string,
  sources: readonly string[],
  message: unknown,
): NativeEvent | undefined {
  if (sources.length === 0 || !isInitMessage(message)) return undefined;
  const text = [
    `Claude Code settings loaded from: ${sources.join(", ")}.`,
    countedList("Skills", stringsOf(message.skills)),
    countedList("Plugins", pluginNamesOf(message.plugins)),
    `Tools: ${stringsOf(message.tools).length}.`,
  ].join(" ");
  return { type: "notice", key: `settings-sources:${operationId}`, code: "settings-sources", text };
}
