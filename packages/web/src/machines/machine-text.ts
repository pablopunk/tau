import type { Machine } from "@tau/protocol";

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

export const isUsable = (machine: Machine): boolean =>
  machine.status === "online" || machine.status === "reconnecting";

export function stateLine(machine: Machine, now: number): string {
  if (machine.status === "online") return "Online";
  if (machine.status === "reconnecting") return "Reconnecting…";
  if (machine.status === "update-required") return `Update tau on ${machine.name}`;
  return `Offline, last seen ${agoText(machine.lastSeenAt, now)}`;
}

export const updateCommand = "npm i -g tau@latest";

export const CONNECT_POWER_NOTE =
  "The hub gets full power on the machine you connect: its terminals, its agents and its Claude login. Everything on that machine, threads and files in them, shows up in this tau. Connect only machines you own.";

export const osLabel = (os: string): string =>
  ({ darwin: "macOS", linux: "Linux", win32: "Windows" })[os] ?? os;
