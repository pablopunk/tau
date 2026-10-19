import type { RemoteState, RemoteStatus } from "@tau/protocol";
import type { StatusChipTone } from "@/components/ui/status-chip";

export const SLEEP_NOTE =
  "Remote access works only while this Mac is awake. If it sleeps, devices cannot connect until it wakes.";
export const FULL_POWER_NOTE =
  "A linked device has full power: it can use every terminal and agent on this computer. Link only devices you own.";
export const OFF_CONFIRM =
  "The URL is kept, but linked devices cannot connect while remote access is off. Turning it on again is fast and uses the same URL.";
export const RECREATE_CONFIRM =
  "This deletes the current URL. Every device must pair again, and the new URL takes a few minutes to be ready.";

const CHIPS: Record<RemoteState, { label: string; tone: StatusChipTone }> = {
  off: { label: "Off", tone: "neutral" },
  starting: { label: "Setting up", tone: "busy" },
  online: { label: "Online", tone: "success" },
  reconnecting: { label: "Reconnecting", tone: "busy" },
  error: { label: "Error", tone: "error" },
};

export const chipFor = (state: RemoteState) => CHIPS[state];

export function stateNote(status: RemoteStatus): string | null {
  if (status.state === "starting") return startingText(status, Date.now());
  if (status.state === "reconnecting") return status.message ?? "Connection lost. Trying again.";
  if (status.state === "error") return status.message ?? "Remote access could not start.";
  return null;
}

export function startingText(status: RemoteStatus, now: number): string {
  const minutes = status.since === null ? 0 : Math.max(0, Math.floor((now - status.since) / 60_000));
  const sofar = minutes < 1 ? "just started" : `${minutes} min so far`;
  return `Setting up remote access, ${sofar} (usually 3-6 minutes). You can close this window.`;
}

export function uptimeText(status: RemoteStatus, now: number): string | null {
  if (status.state !== "online" || status.since === null) return null;
  const minutes = Math.max(0, Math.floor((now - status.since) / 60_000));
  const base = minutes < 1 ? "Online for less than a minute" : `Online for ${duration(minutes)}`;
  return status.message ? `${base}. ${status.message}` : base;
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

export function countdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
