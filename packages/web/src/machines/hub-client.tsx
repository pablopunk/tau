import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";

const HubClientContext = createContext<QueryClient | undefined>(undefined);

/** Publishes the hub's `QueryClient` below the hub's own provider, so remote providers do not hide it. */
export function HubClientProvider({
  isHub,
  client,
  children,
}: {
  readonly isHub: boolean;
  readonly client: QueryClient;
  readonly children: ReactNode;
}) {
  if (!isHub) return children;
  return <HubClientContext.Provider value={client}>{children}</HubClientContext.Provider>;
}

/** The hub's cache even inside a linked machine's provider; falls back to the nearest client (tests). */
export function useHubQueryClient(): QueryClient {
  const hub = useContext(HubClientContext);
  const nearest = useQueryClient();
  return hub ?? nearest;
}
