import type { Node, UpdateStatus } from "@tau/protocol";
import { isBehind } from "@tau/protocol";
import { callRoute, discoverServer } from "../commands/client";
import { processEnv } from "../commands/command-env";

export interface LinkedNodes {
  readonly nodes: readonly Pick<Node, "name" | "tauVersion" | "linkedTo">[];
  /** The hub's own latest; null when it does not know it. */
  readonly hubLatest: string | null;
}

/** Best effort: `undefined` when no server runs or any request fails. */
export async function fetchLinkedNodes(home: string): Promise<LinkedNodes | undefined> {
  try {
    const env = { ...processEnv(), home };
    const server = await discoverServer(env);
    const nodes = (await callRoute(server, "listNodes", {}, env)) as Node[];
    if (nodes.length === 0) return undefined;
    const status = (await callRoute(server, "getUpdateStatus", {}, env)) as UpdateStatus;
    return { nodes, hubLatest: status.latest };
  } catch {
    return undefined;
  }
}

/** The "Linked nodes behind" line, or undefined when nothing is behind or worth saying. */
export function linkedNodesLine(linked: LinkedNodes | undefined, fallbackLatest: string): string | undefined {
  if (!linked) return undefined;
  const latest = linked.hubLatest ?? fallbackLatest;
  const items = linked.nodes
    .filter((m) => !m.linkedTo)
    .flatMap((m) => {
      const behind = isBehind(m.tauVersion, latest);
      if (behind === undefined) return [`${m.name} (version unknown)`];
      return behind ? [`${m.name} (${m.tauVersion})`] : [];
    });
  return items.length === 0 ? undefined : `Linked nodes behind: ${items.join(", ")}`;
}
