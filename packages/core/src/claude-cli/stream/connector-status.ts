import type { ClaudeMcpServerStatus, ClaudeSdkPort } from "../sdk-types";
import type { Runtime } from "./runtime";
import { waitForConnectors } from "./wait-connectors";

export const STATUS_CACHE_MS = 60_000;

type StatusList = readonly ClaudeMcpServerStatus[];

async function probeStatus(rt: Runtime, port: ClaudeSdkPort): Promise<StatusList | null> {
  const probe = port.startProbe();
  try {
    return await waitForConnectors(rt.deps.clock, probe);
  } catch {
    return null;
  } finally {
    probe.close();
  }
}

async function cachedProbe(rt: Runtime, port: ClaudeSdkPort): Promise<StatusList | null> {
  const now = rt.deps.clock.now();
  if (rt.statusCache && now - rt.statusCache.at < STATUS_CACHE_MS) return rt.statusCache.value;
  const value = await probeStatus(rt, port);
  if (value) rt.statusCache = { at: rt.deps.clock.now(), value };
  return value;
}

/** Tool names and read-only flags of every connector: from the service's cache, else one adapter probe. */
export async function readConnectorStatus(rt: Runtime, port: ClaudeSdkPort): Promise<StatusList | null> {
  if (rt.deps.connectorStatus) return rt.deps.connectorStatus().catch(() => null);
  return cachedProbe(rt, port);
}
