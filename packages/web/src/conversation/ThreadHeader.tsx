import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { MachineAvatar } from "@/components/ui/machine-avatar";
import { NodeName } from "@/components/ui/node-name";
import { useAllConversations } from "@/lib/queries";
import { useMachineId } from "@/machines/machine-context";
import { useMachineAvatar } from "@/machines/use-machine-avatar";
import { useMachineName } from "@/machines/use-machine-name";

export function ThreadHeader({ id, extras }: { id: string; extras?: ReactNode }) {
  const title = useAllConversations().data?.find((summary) => summary.id === id)?.title || "Conversation";
  const machineId = useMachineId();
  const machineName = useMachineName(machineId);
  const avatar = useMachineAvatar(machineId);
  return (
    <header className="flex min-w-0 items-center gap-2 border-b px-4 py-2">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      {machineName ? (
        <Badge variant="outline">
          <MachineAvatar os={avatar.os} status={avatar.status} />
          <NodeName name={machineName} local={machineId === undefined} />
        </Badge>
      ) : null}
      {extras}
    </header>
  );
}
