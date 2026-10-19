import type { NodeLinkReport, NodeLinkState } from "@tau/protocol";

const MESSAGES: Partial<Record<NodeLinkState, string>> = {
  reconnecting: "Reconnecting to the node",
  unreachable: "Node unreachable",
  "update-required": "Update tau on the other node or on this one",
  refused: "The other node refused this node. Run `tau disconnect`, then link again.",
  duplicate: "Duplicate identity",
  standby: "Another link to this node is up",
};

export const DEFAULT_MESSAGE = (state: NodeLinkState): string | null => MESSAGES[state] ?? null;

export function linkReportOf(state: NodeLinkState, since: number, message?: string): NodeLinkReport {
  return { state, since, message: message ?? DEFAULT_MESSAGE(state) };
}
