import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { useAllConversations } from "@/lib/queries";
import { useMachineId } from "@/machines/machine-context";
import { useMachineName } from "@/machines/use-machine-name";

export function ThreadHeader({ id, extras }: { id: string; extras?: ReactNode }) {
  const title = useAllConversations().data?.find((summary) => summary.id === id)?.title || "Conversation";
  const machineName = useMachineName(useMachineId());
  return (
    <header className="flex min-w-0 items-center gap-2 border-b px-4 py-2">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      {machineName ? <Badge variant="outline">{machineName}</Badge> : null}
      {extras}
    </header>
  );
}
