import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { createLiveClient, type LiveClient, LiveClientProvider } from "@/conversation";
import type { Api } from "@/lib/api";
import { useChangedInvalidation } from "@/lib/use-changed-invalidation";
import { HubClientProvider } from "./hub-client";
import { apiOfNode } from "./node-apis";
import { NodeApiProvider } from "./node-context";

function ChangedInvalidation() {
  useChangedInvalidation();
  return null;
}

export interface NodeProviderProps {
  /** Absent: the hub's own node, no URL prefix. */
  readonly nodeId?: string;
  readonly children: ReactNode;
}

interface NodeClients {
  readonly queryClient: QueryClient;
  readonly liveClient: LiveClient;
}

const remoteClients = new Map<string, NodeClients>();

function createClients(api: Api): NodeClients {
  return {
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    liveClient: createLiveClient(api.live),
  };
}

/** A linked node keeps one cache and one live client for the page's life, shared by its sidebar group and its thread. */
function clientsOf(nodeId: string | undefined, api: Api): NodeClients {
  if (nodeId === undefined) return createClients(api);
  let clients = remoteClients.get(nodeId);
  if (!clients) {
    clients = createClients(api);
    remoteClients.set(nodeId, clients);
  }
  return clients;
}

export const forgetNodeClients = (): void => remoteClients.clear();

/**
 * Everything one node owns: its `api` (a `Transport` that adds `/api/n/<id>`), its own `QueryClient` (keys cannot
 * leak across nodes) and its own `LiveClient`. Hooks and `queryFn`s read the api with `useApi()`, never the
 * singleton. The hub's own provider also publishes its client for `useNodes()`.
 */
export function NodeProvider({ nodeId, children }: NodeProviderProps) {
  const [api] = useState(() => apiOfNode(nodeId));
  const [{ queryClient, liveClient }] = useState(() => clientsOf(nodeId, api));
  return (
    <NodeApiProvider nodeId={nodeId} api={api}>
      <QueryClientProvider client={queryClient}>
        <HubClientProvider isHub={nodeId === undefined} client={queryClient}>
          <LiveClientProvider client={liveClient}>
            <ChangedInvalidation />
            {children}
          </LiveClientProvider>
        </HubClientProvider>
      </QueryClientProvider>
    </NodeApiProvider>
  );
}
