import { createContext, type ReactNode, useContext, useState } from "react";
import type { Api } from "@/lib/api";
import { apiOfNode } from "./node-apis";

interface NodeContextValue {
  /** `undefined` on the hub's own node. */
  readonly nodeId: string | undefined;
  readonly api: Api;
}

const NodeContext = createContext<NodeContextValue | undefined>(undefined);

/** Only the node context: for tests and callers that bring their own `QueryClient`. */
export function NodeApiProvider({
  nodeId,
  api,
  children,
}: {
  readonly nodeId?: string;
  readonly api?: Api;
  readonly children: ReactNode;
}) {
  const [value] = useState<NodeContextValue>(() => ({ nodeId, api: api ?? apiOfNode(nodeId) }));
  return <NodeContext.Provider value={value}>{children}</NodeContext.Provider>;
}

function useNodeContext(): NodeContextValue {
  const value = useContext(NodeContext);
  if (!value) throw new Error("useApi and useNodeId need a NodeProvider");
  return value;
}

/** The api of the node whose provider is above. */
export const useApi = (): Api => useNodeContext().api;

/** `undefined` on the hub's own node. */
export const useNodeId = (): string | undefined => useNodeContext().nodeId;
