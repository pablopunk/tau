import { CLAUDE_CLI_NOTICE } from "./ClaudeCliText";

export function ClaudeCliNotice() {
  return <p className="text-sm text-muted-foreground">{CLAUDE_CLI_NOTICE}</p>;
}
