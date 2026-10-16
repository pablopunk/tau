import { useAllConversations } from "@/lib/queries";

export function ThreadHeader({ id }: { id: string }) {
  const title = useAllConversations().data?.find((summary) => summary.id === id)?.title || "Conversation";
  return (
    <header className="flex min-w-0 items-center gap-2 border-b px-4 py-2">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
    </header>
  );
}
