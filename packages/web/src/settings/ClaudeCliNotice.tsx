import { CLAUDE_CLI_NOTICE } from "./ClaudeCliText";

/** Owner C. The one-time notice shown in the row's detail while the state is `needs_notice`. */
export function ClaudeCliNotice() {
  return <p className="text-sm text-muted-foreground">{CLAUDE_CLI_NOTICE}</p>;
}
