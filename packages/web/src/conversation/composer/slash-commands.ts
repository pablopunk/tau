export type CommandName = "compact" | "new" | "model" | "thinking" | "rename" | "archive" | "goal" | "loop";

export interface SlashCommand {
  readonly name: CommandName;
  readonly description: string;
}

export type CommandHandlers = Partial<Record<CommandName, (args: string) => void | Promise<void>>>;

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "compact", description: "Summarize older messages [instructions]" },
  { name: "new", description: "Start a new thread in this project" },
  { name: "model", description: "Change the model" },
  { name: "thinking", description: "Change the thinking level" },
  { name: "rename", description: "Rename this thread" },
  { name: "archive", description: "Archive this thread" },
  { name: "goal", description: "Work until a condition is met [condition | clear]" },
  { name: "loop", description: "Repeat a prompt: [5m] <prompt>, or stop" },
];

export function availableCommands(handlers: CommandHandlers): readonly SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => handlers[command.name]);
}

export function slashQuery(text: string): string | null {
  return /^\/(\S*)$/.exec(text)?.[1] ?? null;
}

export function filterCommands(commands: readonly SlashCommand[], query: string): readonly SlashCommand[] {
  return commands.filter((command) => command.name.startsWith(query.toLowerCase()));
}

export function parseSlashCommand(text: string): { name: CommandName; args: string } | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const command = SLASH_COMMANDS.find((candidate) => candidate.name === match?.[1]);
  return command ? { name: command.name, args: (match?.[2] ?? "").trim() } : null;
}
