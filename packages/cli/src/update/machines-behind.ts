import type { Machine, UpdateStatus } from "@tau/protocol";
import { isBehind } from "@tau/protocol";
import { callRoute, discoverServer } from "../commands/client";
import { processEnv } from "../commands/command-env";

export interface LinkedMachines {
  readonly machines: readonly Pick<Machine, "name" | "tauVersion" | "linkedTo">[];
  /** The hub's own latest; null when it does not know it. */
  readonly hubLatest: string | null;
}

/** Best effort: `undefined` when no server runs or any request fails. */
export async function fetchLinkedMachines(home: string): Promise<LinkedMachines | undefined> {
  try {
    const env = { ...processEnv(), home };
    const server = await discoverServer(env);
    const machines = (await callRoute(server, "listMachines", {}, env)) as Machine[];
    if (machines.length === 0) return undefined;
    const status = (await callRoute(server, "getUpdateStatus", {}, env)) as UpdateStatus;
    return { machines, hubLatest: status.latest };
  } catch {
    return undefined;
  }
}

/** The "Linked machines behind" line, or undefined when nothing is behind or worth saying. */
export function linkedMachinesLine(
  linked: LinkedMachines | undefined,
  fallbackLatest: string,
): string | undefined {
  if (!linked) return undefined;
  const latest = linked.hubLatest ?? fallbackLatest;
  const items = linked.machines
    .filter((m) => !m.linkedTo)
    .flatMap((m) => {
      const behind = isBehind(m.tauVersion, latest);
      if (behind === undefined) return [`${m.name} (version unknown)`];
      return behind ? [`${m.name} (${m.tauVersion})`] : [];
    });
  return items.length === 0 ? undefined : `Linked machines behind: ${items.join(", ")}`;
}
