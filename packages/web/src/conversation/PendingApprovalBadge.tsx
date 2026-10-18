import { Badge } from "@/components/ui/badge";
import { useApprovals } from "@/lib/queries";

export const APPROVAL_BADGE_TEXT = "Needs approval";

/** Shown on a subagent card and its sidebar row while that child thread waits for the user. */
export function PendingApprovalBadge({
  conversationId,
  enabled = true,
}: {
  conversationId: string;
  enabled?: boolean;
}) {
  const approvals = useApprovals(conversationId, enabled);
  if (!approvals.data?.length) return null;
  return <Badge variant="destructive">{APPROVAL_BADGE_TEXT}</Badge>;
}
