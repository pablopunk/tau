import { useEffect } from "react";
import { reconcileNodeIds } from "@/lib/node-id-reconcile";
import { useNodes } from "./NodeRegistry";

/** Lazily moves a node's browser keys to its `nodeId` once the list reports it (see `lib/node-id-reconcile.ts`). */
export function useNodeIdReconcile(): void {
  const { nodes, isLoading } = useNodes();
  const signature = nodes.map((node) => `${node.id}:${node.identified}:${node.name}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` stands for the list
  useEffect(() => {
    if (isLoading) return;
    try {
      reconcileNodeIds(window.localStorage, nodes);
    } catch {
      // Storage unavailable: keys stay where they are.
    }
  }, [signature, isLoading]);
}
