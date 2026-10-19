import { machineApiPrefix } from "@tau/protocol";

/** The hub's own machine has no prefix: its URLs are exactly today's. A linked machine's start with `/m/<machineId>`. */
export const machinePrefix = (machineId?: string): string =>
  machineId === undefined ? "" : `/m/${encodeURIComponent(machineId)}`;

export const conversationPath = (projectId: string, conversationId: string, machineId?: string) =>
  `${machinePrefix(machineId)}/p/${encodeURIComponent(projectId)}/c/${encodeURIComponent(conversationId)}`;

export const newThreadPath = (projectId?: string, machineId?: string) => {
  const parts = [
    ...(projectId === undefined ? [] : [`project=${encodeURIComponent(projectId)}`]),
    ...(machineId === undefined ? [] : [`machine=${encodeURIComponent(machineId)}`]),
  ];
  return parts.length === 0 ? "/new" : `/new?${parts.join("&")}`;
};

export const terminalPath = (
  projectId: string,
  conversationId: string,
  terminalId?: string,
  machineId?: string,
) =>
  terminalId === undefined
    ? `${conversationPath(projectId, conversationId, machineId)}/terminal`
    : `${conversationPath(projectId, conversationId, machineId)}/terminal/${encodeURIComponent(terminalId)}`;

/** The route patterns, for `useMatch` and the router: one place next to the builders. */
export const CONVERSATION_ROUTE = "/p/:projectId/c/:conversationId/*";
export const MACHINE_CONVERSATION_ROUTE = "/m/:machineId/p/:projectId/c/:conversationId/*";

/** A machine's root-relative asset URL (such as `iconUrl`), reachable from the hub: linked machines go through `/api/m/<machineId>`. */
export const machineAssetUrl = (url: string, machineId?: string): string =>
  machineId === undefined || !url.startsWith("/") ? url : `${machineApiPrefix(machineId)}${url}`;
