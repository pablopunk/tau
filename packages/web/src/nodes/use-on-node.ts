import { useNodes } from "./NodeRegistry";
import { useNodeId } from "./node-context";

/** " on Homelab" inside a linked node's provider, "" on the hub's own node: folder pickers say whose disk they browse. */
export function useOnNode(): string {
  const nodeId = useNodeId();
  const { nodes } = useNodes();
  if (nodeId === undefined) return "";
  const name = nodes.find((node) => node.id === nodeId)?.name;
  return name ? ` on ${name}` : " on that node";
}
