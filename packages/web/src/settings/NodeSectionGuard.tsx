import type { ReactNode } from "react";
import { FieldDescription } from "@/components/ui/field";
import { NodeAvatar } from "@/components/ui/node-avatar";
import { NodeProvider, useNodes } from "@/nodes";

const STATUS_NOTE: Record<string, string> = {
  offline: "is offline right now",
  reconnecting: "is reconnecting",
  unreachable: "can't be reached right now",
  "update-required": "needs a tau update before its settings can load",
};

function OfflineNotice({ name, status }: { name: string; status: string }) {
  const note = STATUS_NOTE[status] ?? "can't be reached right now";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed p-4">
      <NodeAvatar os={undefined} status={status === "online" ? "online" : "offline"} />
      <FieldDescription>
        {name} {note}. Its settings will load once it's back online.
      </FieldDescription>
    </div>
  );
}

/**
 * Wraps a per-node section body in that node's `NodeProvider`, or a status notice instead of mounting it
 * when the node isn't reachable. `nodeId` undefined (this node) is always reachable and needs no wrapping.
 */
export function NodeSectionGuard({ nodeId, children }: { nodeId?: string; children: ReactNode }) {
  const { nodes } = useNodes();
  if (nodeId === undefined) return <>{children}</>;
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (node?.status !== "online")
    return <OfflineNotice name={node?.name ?? "This node"} status={node?.status ?? "offline"} />;
  return <NodeProvider nodeId={nodeId}>{children}</NodeProvider>;
}
