import { useNodes } from "./NodeRegistry";
import { isUsable } from "./node-text";
import { useHubName } from "./use-node-avatar";

/**
 * The name to show next to a thread, but only when more than one node is online (the hub's own counts as one);
 * with a single node the name is just noise.
 */
export function useNodeName(nodeId: string | undefined): string | undefined {
  const { nodes } = useNodes();
  const hubName = useHubName();
  const online = nodes.filter(isUsable);
  if (online.length === 0) return undefined;
  if (nodeId === undefined) return hubName;
  return nodes.find((node) => node.id === nodeId)?.name;
}
