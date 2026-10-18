import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAllConversations } from "@/lib/queries";
import { notificationVerb } from "./notification-entry";

const TAG_PATTERN = /^\s*<([a-z-]+)([^>]*)>([\s\S]*?)(?:<\/\1>\s*)?$/;

const attribute = (attrs: string, name: string): string | undefined =>
  new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];

export function QueuedNotificationRow({ text }: { text: string }) {
  const conversations = useAllConversations().data;
  const match = TAG_PATTERN.exec(text);
  const tag = match?.[1] ?? "notification";
  const attrs = match?.[2] ?? "";
  const body = (match?.[3] ?? text).trim();
  const title = conversations?.find((item) => item.id === attribute(attrs, "id"))?.title;
  const status = attribute(attrs, "status");
  const summary =
    tag === "subagent-notification"
      ? `Subagent ${title ?? ""} ${notificationVerb((status ?? "done") as Parameters<typeof notificationVerb>[0])}`
      : tag.replace(/-/g, " ");
  return (
    <Collapsible data-testid="queued-notification" className="rounded-lg border bg-card text-sm opacity-70">
      <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
        />
        <span className="truncate">{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="whitespace-pre-wrap border-t px-3 py-2 text-xs">
        {body}
      </CollapsibleContent>
    </Collapsible>
  );
}
