import type { ClaudeMcpServerStatus, ClaudeSdkPort } from "../sdk-types";
import type { Runtime } from "./runtime";
import { waitForProbeStatus } from "./wait-connectors";

export const STATUS_CACHE_MS = 60_000;

type StatusList = readonly ClaudeMcpServerStatus[];

async function cachedProbe(rt: Runtime, port: ClaudeSdkPort): Promise<StatusList | null> {
  const now = rt.deps.clock.now();
  if (rt.statusCache && now - rt.statusCache.at < STATUS_CACHE_MS) return rt.statusCache.value;
  const probe = port.startProbe();
  let value: StatusList | null;
  try {
    value = await waitForProbeStatus(rt.deps.clock, probe);
  } catch {
    value = null;
  } finally {
    probe.close();
  }
  if (value) rt.statusCache = { at: rt.deps.clock.now(), value };
  return value;
}

/** Tool names and read-only flags of every connector: from the service's cache, else one adapter probe. */
export async function readConnectorStatus(rt: Runtime, port: ClaudeSdkPort): Promise<StatusList | null> {
  if (rt.deps.connectorStatus) return rt.deps.connectorStatus().catch(() => null);
  return cachedProbe(rt, port);
}
