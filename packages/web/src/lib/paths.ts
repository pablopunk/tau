import { nodeApiPrefix } from "@tau/protocol";

/** The hub's own node has no prefix: its URLs are exactly today's. A linked node's start with `/n/<nodeId>`. */
export const nodePrefix = (nodeId?: string): string =>
  nodeId === undefined ? "" : `/n/${encodeURIComponent(nodeId)}`;

export const conversationPath = (projectId: string, conversationId: string, nodeId?: string) =>
  `${nodePrefix(nodeId)}/p/${encodeURIComponent(projectId)}/c/${encodeURIComponent(conversationId)}`;

export const newThreadPath = (projectId?: string, nodeId?: string) => {
  const parts = [
    ...(projectId === undefined ? [] : [`project=${encodeURIComponent(projectId)}`]),
    ...(nodeId === undefined ? [] : [`node=${encodeURIComponent(nodeId)}`]),
  ];
  return parts.length === 0 ? "/new" : `/new?${parts.join("&")}`;
};

export const terminalPath = (
  projectId: string,
  conversationId: string,
  terminalId?: string,
  nodeId?: string,
) =>
  terminalId === undefined
    ? `${conversationPath(projectId, conversationId, nodeId)}/terminal`
    : `${conversationPath(projectId, conversationId, nodeId)}/terminal/${encodeURIComponent(terminalId)}`;

/** The route patterns, for `useMatch` and the router: one place next to the builders. */
export const CONVERSATION_ROUTE = "/p/:projectId/c/:conversationId/*";
export const NODE_CONVERSATION_ROUTE = "/n/:nodeId/p/:projectId/c/:conversationId/*";

/** A node's root-relative asset URL (such as `iconUrl`), reachable from the hub: linked nodes go through `/api/n/<nodeId>`. */
export const nodeAssetUrl = (url: string, nodeId?: string): string =>
  nodeId === undefined || !url.startsWith("/") ? url : `${nodeApiPrefix(nodeId)}${url}`;
