import type { Approval, ApprovalDecision } from "@tau/protocol";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AnimatePresence, gentle, motion, rise } from "@/components/ui/motion";
import { useApprovals, useDecideApproval } from "@/lib/queries";
import { connectorLabel } from "./tools/ClaudeConnectorTool";

function ApprovalCard({ approval }: { approval: Approval }) {
  const decide = useDecideApproval(approval.conversationId);
  const choose = (decision: ApprovalDecision) => decide.mutate({ toolUseId: approval.toolUseId, decision });
  return (
    <motion.section
      aria-label="Tool approval"
      {...rise}
      transition={gentle}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm"
    >
      <span className="font-medium">{connectorLabel(approval.server, approval.tool)}</span>
      <Collapsible>
        <CollapsibleTrigger className="text-xs text-muted-foreground">Arguments</CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="overflow-x-auto font-mono text-xs">
            {JSON.stringify(approval.arguments, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={decide.isPending} onClick={() => choose("allow")}>
          Allow once
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={decide.isPending}
          onClick={() => choose("allow_always")}
        >
          Always allow this tool
        </Button>
        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => choose("deny")}>
          Deny
        </Button>
      </div>
    </motion.section>
  );
}

export function ToolApproval({ conversationId }: { conversationId: string }) {
  const approvals = useApprovals(conversationId);
  if (!approvals.data?.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {approvals.data.map((approval) => (
          <ApprovalCard key={approval.toolUseId} approval={approval} />
        ))}
      </AnimatePresence>
    </div>
  );
}
