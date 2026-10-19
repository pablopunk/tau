import type { ConversationSummary } from "@tau/protocol";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { conversationPath } from "@/lib/paths";
import { useMachineId } from "@/machines/machine-context";

export function AgentOpenLink({ child }: { child: ConversationSummary }) {
  const machineId = useMachineId();
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={conversationPath(child.projectId, child.id, machineId)}>Open</Link>
    </Button>
  );
}
