import { useQueries } from "@tanstack/react-query";
import type { ConversationSummary, NodeStatus, Project } from "@tau/protocol";
import { useMemo } from "react";
import { byActivity, queryKeys } from "@/lib/queries";
import { useHubQueryClient } from "./hub-client";
import { useNodes } from "./NodeRegistry";
import { apiOfNode } from "./node-apis";
import { isUsable } from "./node-text";
import { useHubName, useHubOs } from "./use-node-avatar";

const REMOTE_REFRESH_MS = 15_000;

export interface NodeData {
  /** `undefined`: the hub's own node. */
  readonly nodeId: string | undefined;
  readonly name: string;
  /** The hub's own node: its name is shown with a dim "local". */
  readonly local: boolean;
  readonly os: string | undefined;
  readonly status: NodeStatus;
  readonly projects: readonly Project[];
  readonly conversations: readonly ConversationSummary[];
}

/**
 * Projects and threads of every reachable node, for components outside one node's provider (the command
 * palette, notifications, the new-thread project picker). The hub's own node shares the hub cache
 * (live); linked nodes are cached in the hub's client under `["node-data", id, ...]`, so they cannot mix with a node's own cache, and refreshed every 15 s (a node's
 * own sidebar group stays live through its provider).
 */
export function useNodesData(): NodeData[] {
  const { nodes } = useNodes();
  const hub = useHubQueryClient();
  const hubOs = useHubOs();
  const hubName = useHubName();
  const localApi = apiOfNode();
  const remote = nodes.filter(isUsable);
  const results = useQueries(
    {
      queries: [
        { queryKey: queryKeys.projects, queryFn: () => localApi.projects.list() },
        {
          queryKey: queryKeys.allConversations,
          queryFn: async () => (await localApi.conversations.listAll()).sort(byActivity),
        },
        ...remote.flatMap((node) => [
          {
            queryKey: [...queryKeys.nodeData(node.id), "projects"],
            queryFn: () => apiOfNode(node.id).projects.list(),
            refetchInterval: REMOTE_REFRESH_MS,
          },
          {
            queryKey: [...queryKeys.nodeData(node.id), "conversations"],
            queryFn: async () => (await apiOfNode(node.id).conversations.listAll()).sort(byActivity),
            refetchInterval: REMOTE_REFRESH_MS,
          },
        ]),
      ],
    },
    hub,
  );
  const signature = results.map((result) => result.dataUpdatedAt).join(",");
  const remoteKey = remote.map((node) => `${node.id}:${node.name}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` and `remoteKey` stand for the results and nodes
  return useMemo(() => {
    const local: NodeData = {
      nodeId: undefined,
      name: hubName,
      local: true,
      os: hubOs,
      status: "online",
      projects: (results[0]?.data as Project[] | undefined) ?? [],
      conversations: (results[1]?.data as ConversationSummary[] | undefined) ?? [],
    };
    const others = remote.map((node, index): NodeData => {
      return {
        nodeId: node.id,
        name: node.name,
        local: false,
        os: node.os,
        status: node.status,
        projects: (results[2 + index * 2]?.data as Project[] | undefined) ?? [],
        conversations: (results[3 + index * 2]?.data as ConversationSummary[] | undefined) ?? [],
      };
    });
    return [local, ...others];
  }, [signature, remoteKey, hubOs, hubName]);
}
