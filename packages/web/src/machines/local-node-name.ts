export const LOCAL_NODE_FALLBACK = "Local";

/** The local node's own name, or "Local" when it reports none. */
export function localNodeName(name: string | undefined): string {
  return name?.trim() || LOCAL_NODE_FALLBACK;
}
