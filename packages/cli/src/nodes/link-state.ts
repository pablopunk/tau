import { peerIdOf } from "@tau/core";
import type { NodeLinkReport, NodeLinkState } from "@tau/protocol";
import type { HubFile } from "./hub-file";

/** The old client also knew `none` (no hub file): nothing to report then. */
export type HubLinkStateName = NodeLinkState | "none";

const MESSAGES: Partial<Record<NodeLinkState, string>> = {
  reconnecting: "Reconnecting to the node",
  unreachable: "Node unreachable",
  "update-required": "Update tau on the other node or on this one",
  refused: "The other node refused this node. Run `tau disconnect`, then link again.",
};

export const peerIdOfFile = (file: HubFile): string => peerIdOf({ url: file.hubUrl });

/** `undefined` for `none`. */
export function linkReportOf(state: HubLinkStateName, since: number): NodeLinkReport | undefined {
  if (state === "none") return undefined;
  return { state, since, message: MESSAGES[state] ?? null };
}

export const fileKey = (file: HubFile | undefined): string =>
  file ? `${file.hubUrl}\n${file.nodeSecret}` : "";
