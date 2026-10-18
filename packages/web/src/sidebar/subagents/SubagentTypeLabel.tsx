import type { ConversationSummary } from "@tau/protocol";
import { isSpecialType } from "./agent-meta";

export function SubagentTypeLabel({ conversation }: { conversation: ConversationSummary }) {
  if (!conversation.parentId || !isSpecialType(conversation.agentType)) return null;
  return (
    <span data-slot="subagent-type" className="truncate text-xs text-muted-foreground">
      {conversation.agentType}
    </span>
  );
}
