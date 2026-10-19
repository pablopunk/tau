import { type Api, createApi, api as localApi } from "@/lib/api";
import { createNodeTransport } from "@/lib/transport/node";

const cache = new Map<string, Api>();

/**
 * The typed client of one node. `undefined` is the hub's own node: today's `api`, no prefix.
 * One client per node id for the page's life (its transport holds no state, sockets are opened on demand).
 */
export function apiOfNode(nodeId?: string): Api {
  if (nodeId === undefined) return localApi;
  let nodeApi = cache.get(nodeId);
  if (!nodeApi) {
    nodeApi = createApi(createNodeTransport(nodeId));
    cache.set(nodeId, nodeApi);
  }
  return nodeApi;
}

export const forgetNodeApis = (): void => cache.clear();
