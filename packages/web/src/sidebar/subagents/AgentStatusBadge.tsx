import type { AgentStatus } from "@pi-everywhere/protocol";
import { Badge } from "@/components/ui/badge";

const VARIANTS = {
  running: "secondary",
  done: "outline",
  failed: "destructive",
  stopped: "outline",
} as const;

export function AgentStatusBadge({ status }: { status: AgentStatus | null | undefined }) {
  if (!status) return null;
  return (
    <Badge variant={VARIANTS[status]} data-agent-status={status}>
      {status}
    </Badge>
  );
}
