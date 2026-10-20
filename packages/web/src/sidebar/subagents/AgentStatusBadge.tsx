import type { AgentStatus } from "@tau/protocol";
import { Badge } from "@/components/ui/badge";
import { MorphText } from "@/components/ui/morph-text";

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
      <MorphText>{status}</MorphText>
    </Badge>
  );
}
