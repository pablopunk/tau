import { useQueries } from "@tanstack/react-query";
import { isConnected } from "@/lib/api";
import { queryKeys, useProviders } from "@/lib/queries";
import { useHubQueryClient } from "./hub-client";
import { useNodes } from "./NodeRegistry";
import { apiOfNode } from "./node-apis";
import { isUsable } from "./node-text";

export interface DefaultTarget {
  /** The node a new thread starts on: `undefined` is this node. */
  readonly nodeId: string | undefined;
  /** False while it is still unknown whether this node has a provider. */
  readonly ready: boolean;
}

/** The first of the candidates that has a provider; this node first. Pure so the rule is tested alone. */
export function firstWithProvider(
  localHasProvider: boolean,
  others: ReadonlyArray<{ id: string; hasProvider: boolean }>,
): string | undefined {
  if (localHasProvider) return undefined;
  return others.find((node) => node.hasProvider)?.id;
}

/**
 * Where "New thread" lands when the URL names no node: this node when it has a provider, else the first usable
 * node that has one (a node that skipped setup works through its peers), else this node (it shows "not set up").
 */
export function useDefaultTarget(): DefaultTarget {
  const { nodes, isLoading } = useNodes();
  const providers = useProviders();
  const hub = useHubQueryClient();
  const usable = nodes.filter(isUsable);
  const localHas = providers.data?.some(isConnected) ?? false;
  const others = useQueries(
    {
      queries: usable.map((node) => ({
        queryKey: [...queryKeys.nodeData(node.id), "providers"],
        queryFn: () => apiOfNode(node.id).providers.list(),
        enabled: !localHas,
      })),
    },
    hub,
  );
  if (providers.isPending || isLoading) return { nodeId: undefined, ready: false };
  if (localHas) return { nodeId: undefined, ready: true };
  const pending = others.some((query) => query.isPending);
  const found = firstWithProvider(
    false,
    usable.map((node, index) => ({
      id: node.id,
      hasProvider: others[index]?.data?.some(isConnected) ?? false,
    })),
  );
  return { nodeId: found, ready: !pending };
}
