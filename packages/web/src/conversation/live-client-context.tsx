import { createContext, type ReactNode, useContext } from "react";
import type { LiveClient } from "./live-client";

const LiveClientContext = createContext<LiveClient | undefined>(undefined);

export function LiveClientProvider({ client, children }: { client: LiveClient; children: ReactNode }) {
  return <LiveClientContext.Provider value={client}>{children}</LiveClientContext.Provider>;
}

export function useLiveClient(): LiveClient {
  const client = useContext(LiveClientContext);
  if (!client) throw new Error("useLiveClient needs a <LiveClientProvider>");
  return client;
}
