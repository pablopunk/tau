import type { SubagentNotificationData } from "@tau/protocol";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { conversationPath } from "@/lib/paths";
import { useAllConversations } from "@/lib/queries";
import { useNodeId } from "@/nodes/node-context";
import { Markdown } from "../messages/Markdown";
import { notificationVerb } from "./notification-entry";

export function SubagentNotificationRow({ data }: { data: SubagentNotificationData }) {
  const nodeId = useNodeId();
  const child = useAllConversations().data?.find((item) => item.id === data.childId);
  return (
    <Collapsible data-testid="subagent-notification" className="rounded-lg border bg-card text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
          />
          <span className="truncate">
            Subagent <span className="font-medium">{data.title}</span> {notificationVerb(data.status)}
          </span>
        </CollapsibleTrigger>
        {child ? (
          <Link className="text-xs underline" to={conversationPath(child.projectId, child.id, nodeId)}>
            Open
          </Link>
        ) : null}
      </div>
      <CollapsibleContent className="border-t px-3 py-2">
        <Markdown>{data.report}</Markdown>
      </CollapsibleContent>
    </Collapsible>
  );
}
