import { useQuery } from "@tanstack/react-query";
import type { DirectoryNode } from "@tau/protocol";
import { type Api, api as hubApi } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { useHubQueryClient } from "./hub-client";
import { apiOfNode } from "./node-apis";

export interface NodeRegistry {
  /** The group as this hub sees it: neighbours, then routed nodes (`via`). The hub's own node is not in the list. */
  readonly nodes: readonly DirectoryNode[];
  readonly isLoading: boolean;
}

/**
 * For components outside one node's provider (the new-thread project picker, notifications, the Nodes page,
 * the command palette). Always reads the hub's list from the hub's cache, also inside a linked node's provider.
 */
export function useNodes(): NodeRegistry {
  const client = useHubQueryClient();
  const { data = [], isLoading } = useQuery(
    { queryKey: queryKeys.nodeDirectory, queryFn: () => hubApi.nodes.directory() },
    client,
  );
  return { nodes: data, isLoading };
}

/** The typed client of any node by id (`undefined`: the hub's own). No provider needed. */
export const useNodeApi = (nodeId?: string): Api => apiOfNode(nodeId);

/** Nodes removed from the group, read from the hub like the directory. */
export function useExpulsions() {
  const client = useHubQueryClient();
  return useQuery({ queryKey: queryKeys.expulsions, queryFn: () => hubApi.nodes.expulsions() }, client);
}
