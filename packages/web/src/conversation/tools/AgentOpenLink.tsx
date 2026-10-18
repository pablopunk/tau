import type { ConversationSummary } from "@tau/protocol";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { conversationPath } from "@/lib/paths";

export function AgentOpenLink({ child }: { child: ConversationSummary }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={conversationPath(child.projectId, child.id)}>Open</Link>
    </Button>
  );
}
