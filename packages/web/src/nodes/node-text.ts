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

export const updateCommand = "npm i -g @pablopunk/tau@latest";

export const CONNECT_POWER_NOTE =
  "The hub gets full power on the node you connect: its terminals, its agents and its Claude login. Everything on that node, threads and files in them, shows up in this tau. Connect only nodes you own.";

export const osLabel = (os: string): string =>
  ({ darwin: "macOS", linux: "Linux", win32: "Windows" })[os] ?? os;
