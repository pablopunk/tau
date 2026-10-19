import { CAPABILITY_ANNOUNCE, type LinkFrame } from "@tau/protocol";
import type { LinkRegistry } from "../link-registry";

/** Sends `frame` to every announce-capable link except `except` (a nodeId). Resolves once every send flushed. */
export async function flood(registry: LinkRegistry, frame: LinkFrame, except?: string): Promise<void> {
  const sends = registry
    .links()
    .filter((link) => link.nodeId !== except && link.capabilities.includes(CAPABILITY_ANNOUNCE))
    .map((link) => link.sendFrame(frame));
  await Promise.all(sends);
}
