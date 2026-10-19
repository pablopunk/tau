import { Navigate, useLocation } from "react-router";
import { resolveLegacyNodeId } from "@/lib/node-id-reconcile";
import { useNodes } from "@/nodes";

const LEGACY_PREFIX = /^\/m\/([^/]+)/;

/**
 * `/m/<id>/...` (the 0.1.x node URL) goes to `/n/<nodeId>/...`. The old id is the device id of that peer; the node
 * list tells which `nodeId` it became (same id when it did not change), keeping the rest, search and hash.
 */
export function LegacyNodeRedirect() {
  const { pathname, search, hash } = useLocation();
  const { nodes, isLoading } = useNodes();
  if (isLoading) return null;
  const match = LEGACY_PREFIX.exec(pathname);
  const oldId = decodeURIComponent(match?.[1] ?? "");
  const rest = match ? pathname.slice(match[0].length) : "";
  const id = resolveLegacyNodeId(window.localStorage, oldId, nodes);
  return <Navigate to={`/n/${encodeURIComponent(id)}${rest}${search}${hash}`} replace />;
}
