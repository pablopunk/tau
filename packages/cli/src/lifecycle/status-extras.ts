import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LockInfo } from "@tau/core";
import type { RemoteStatus } from "@tau/protocol";

export interface LastExitReport {
  readonly reason: string;
  readonly at: number;
  readonly detail?: string;
}

export interface StatusExtras {
  readonly uptimeSeconds: number | null;
  readonly lastExit: LastExitReport | null;
  readonly tunnel: Pick<RemoteStatus, "state" | "url" | "message"> | null;
}

export const NO_EXTRAS: StatusExtras = { uptimeSeconds: null, lastExit: null, tunnel: null };

const execFileAsync = promisify(execFile);

/** `[[dd-]hh:]mm:ss` as printed by `ps -o etime=`. */
export function parseElapsed(text: string): number | null {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(text.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  return ((days ?? 0) * 24 + (hours ?? 0)) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
}

async function uptimeOf(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "etime=", "-p", String(pid)]);
    return parseElapsed(stdout);
  } catch {
    return null;
  }
}

/** Missing or corrupt files give `null`. */
export async function readLastExit(home: string): Promise<LastExitReport | null> {
  try {
    const value = JSON.parse(await readFile(join(home, "last-exit.json"), "utf8")) as Partial<LastExitReport>;
    if (typeof value.reason !== "string" || typeof value.at !== "number") return null;
    return { reason: value.reason, at: value.at, ...(value.detail ? { detail: String(value.detail) } : {}) };
  } catch {
    return null;
  }
}

async function readTunnel(home: string, instance: LockInfo | undefined): Promise<StatusExtras["tunnel"]> {
  if (!instance?.url) return null;
  try {
    const token = (await readFile(join(home, "token"), "utf8")).trim();
    const response = await fetch(`${instance.url}/api/remote`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const { state, url, message } = (await response.json()) as RemoteStatus;
    return { state, url, message };
  } catch {
    return null;
  }
}

export async function realExtras(home: string, instance: LockInfo | undefined): Promise<StatusExtras> {
  const [uptimeSeconds, lastExit, tunnel] = await Promise.all([
    instance ? uptimeOf(instance.pid) : null,
    readLastExit(home),
    readTunnel(home, instance),
  ]);
  return { uptimeSeconds, lastExit, tunnel };
}

export function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return minutes > 0 ? `${minutes}m ${totalSeconds % 60}s` : `${totalSeconds}s`;
}

export function renderExtras(extras: StatusExtras): string[] {
  const { uptimeSeconds, lastExit, tunnel } = extras;
  const exit = lastExit
    ? `${lastExit.reason}${lastExit.detail ? ` (${lastExit.detail})` : ""} at ${new Date(lastExit.at).toISOString()}`
    : "-";
  const tunnelText = tunnel ? `${tunnel.state}${tunnel.url ? ` ${tunnel.url}` : ""}` : "-";
  return [
    `uptime: ${uptimeSeconds === null ? "-" : formatDuration(uptimeSeconds)}`,
    `last exit: ${exit}`,
    `tunnel: ${tunnelText}`,
  ];
}
