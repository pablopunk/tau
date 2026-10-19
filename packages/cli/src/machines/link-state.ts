import { HUB_LINK_NONE, type HubLink, type HubLinkStateName } from "@tau/protocol";
import type { HubFile } from "./hub-file";

const MESSAGES: Partial<Record<HubLinkStateName, string>> = {
  reconnecting: "Reconnecting to the hub",
  unreachable: "Hub unreachable",
  "update-required": "Update tau on the hub or on this machine",
  refused: "The hub refused this machine. Run `tau disconnect`, then link again.",
};

export function hubLinkOf(state: HubLinkStateName, file: HubFile | undefined, since: number): HubLink {
  if (state === "none" || !file) return HUB_LINK_NONE;
  return { state, hubName: file.name, hubUrl: file.hubUrl, since, message: MESSAGES[state] ?? null };
}

export const fileKey = (file: HubFile | undefined): string =>
  file ? `${file.hubUrl}\n${file.machineSecret}` : "";
