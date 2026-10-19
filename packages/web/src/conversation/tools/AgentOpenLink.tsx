import type { ConversationSummary } from "@tau/protocol";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { conversationPath } from "@/lib/paths";
import { useNodeId } from "@/nodes/node-context";

export function AgentOpenLink({ child }: { child: ConversationSummary }) {
  const nodeId = useNodeId();
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={conversationPath(child.projectId, child.id, nodeId)}>Open</Link>
    </Button>
  );
}
