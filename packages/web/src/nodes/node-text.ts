import type { Node } from "@tau/protocol";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function agoText(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  return `${Math.floor(elapsed / DAY)} d ago`;
}

export const isUsable = (node: Node): boolean => node.status === "online" || node.status === "reconnecting";

export function stateLine(node: Node, now: number): string {
  if (node.status === "online") return "Online";
  if (node.status === "reconnecting") return "Reconnecting…";
  if (node.status === "update-required") return `Update tau on ${node.name}`;
  return `Offline, last seen ${agoText(node.lastSeenAt, now)}`;
}

export const updateCommand = "tau update";

export const CONNECT_POWER_TITLE = "Every node in the group gets full power over every other node";

export const CONNECT_POWER_DETAIL =
  "That includes its terminals, its agents, its files and its Claude login. Everything on a node, threads included, shows up on the others. Connect only nodes you own.";

export const CONNECT_POWER_NOTE = `${CONNECT_POWER_TITLE}. ${CONNECT_POWER_DETAIL}`;

/** "darwin arm64" and "darwin" both say "macOS". */
export const osLabel = (os: string): string => {
  const platform = os.trim().split(/\s+/)[0] ?? "";
  return ({ darwin: "macOS", linux: "Linux", win32: "Windows" } as Record<string, string>)[platform] ?? os;
};
