import { Link } from "react-router";
import { conversationPath } from "@/lib/paths";
import { useAllConversations } from "@/lib/queries";

export function SubagentBanner({ parentId }: { parentId: string }) {
  const parent = useAllConversations().data?.find((item) => item.id === parentId);
  if (!parent) return null;
  return (
    <p className="border-b px-4 py-1.5 text-xs text-muted-foreground">
      Subagent of{" "}
      <Link className="underline" to={conversationPath(parent.projectId, parent.id)}>
        {parent.title.trim() || "New thread"}
      </Link>
    </p>
  );
}
