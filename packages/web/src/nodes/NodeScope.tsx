import type { ReactNode } from "react";
import { NodeProvider } from "./NodeProvider";

/** A linked node's page runs under that node's provider; the hub's own node is the root provider. */
export function NodeScope({ nodeId, children }: { nodeId?: string; children: ReactNode }) {
  if (nodeId === undefined) return children;
  return (
    <NodeProvider key={nodeId} nodeId={nodeId}>
      {children}
    </NodeProvider>
  );
}
