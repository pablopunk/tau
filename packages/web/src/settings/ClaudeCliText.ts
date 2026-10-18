import type { ClaudeCliStatus } from "@tau/protocol";

export const CLAUDE_CLI_NOTICE = "Runs the Claude Agent SDK under your own Claude login, for your own use.";

/** Owner C. Frozen signatures; the bodies are a first cut that C replaces with the table in MVP9.md. */
export function claudeCliBadge(cli: ClaudeCliStatus): { label: string; destructive: boolean } {
  if (cli.state === "ready") return { label: "Connected via claude CLI", destructive: false };
  if (cli.state === "blocked") return { label: "Blocked by your organization", destructive: true };
  return { label: cli.state === "needs_notice" ? "Detected" : "Not connected", destructive: false };
}

export function claudeCliNote(cli: ClaudeCliStatus): string | null {
  return cli.message;
}

export type ClaudeCliAction = "acknowledge" | "refresh";

export function claudeCliAction(cli: ClaudeCliStatus): ClaudeCliAction {
  return cli.state === "needs_notice" ? "acknowledge" : "refresh";
}

export const claudeCliActionLabel = (action: ClaudeCliAction): string =>
  action === "acknowledge" ? "I understand" : "Check again";
