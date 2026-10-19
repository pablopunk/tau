import { useQuery } from "@tanstack/react-query";
import type { NodeStatus } from "@tau/protocol";
import { queryKeys } from "@/lib/queries";
import { useHubQueryClient } from "./hub-client";
import { localNodeName } from "./local-node-name";
import { useNodes } from "./NodeRegistry";
import { apiOfNode } from "./node-apis";

/** The OS and name of the hub itself, read from the hub's cache even inside a linked node's provider. */
function useHubInfo() {
  const client = useHubQueryClient();
  const { data } = useQuery(
    { queryKey: queryKeys.nodeSelf, queryFn: () => apiOfNode().nodes.self() },
    client,
  );
  return data;
}

export const useHubOs = (): string | undefined => useHubInfo()?.os;

/** The hub's own name ("Mac"), never empty. */
export const useHubName = (): string => localNodeName(useHubInfo()?.name);

/** OS and status of a node by id (`undefined`: the hub's own, always online). */
export function useNodeAvatar(nodeId: string | undefined): {
  os: string | undefined;
  status: NodeStatus;
} {
  const { nodes } = useNodes();
  const hubOs = useHubOs();
  if (nodeId === undefined) return { os: hubOs, status: "online" };
  const node = nodes.find((candidate) => candidate.id === nodeId);
  return { os: node?.os, status: node?.status ?? "offline" };
}
