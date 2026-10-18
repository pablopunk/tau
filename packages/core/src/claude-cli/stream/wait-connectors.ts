import type { ClaudeCliClock } from "../clock";
import type { ClaudeMcpControl, ClaudeMcpServerStatus } from "../sdk-types";
import { connectorStatusErrorText } from "./errors";

export const CONNECTOR_POLL_MS = 250;
export const CONNECTOR_WAIT_CAP_MS = 10_000;

const isConnector = (server: ClaudeMcpServerStatus) => server.source !== "sdk";

export function connectorsSettled(statuses: readonly ClaudeMcpServerStatus[]): boolean {
  const connectors = statuses.filter(isConnector);
  return connectors.length > 0 && connectors.every((server) => server.status !== "pending");
}

const sleep = (clock: ClaudeCliClock, ms: number): Promise<void> =>
  new Promise((resolve) => clock.setTimer(resolve, ms));

const statusesOf = (control: ClaudeMcpControl): Promise<readonly ClaudeMcpServerStatus[]> =>
  control.mcpServerStatus().catch(() => []);

/** Polls until a non-`sdk` server is listed and none is `pending`, for at most the cap. Returns the last list. */
export async function waitForConnectors(
  clock: ClaudeCliClock,
  control: ClaudeMcpControl,
): Promise<readonly ClaudeMcpServerStatus[]> {
  const startedAt = clock.now();
  let statuses = await statusesOf(control);
  while (!connectorsSettled(statuses) && clock.now() - startedAt < CONNECTOR_WAIT_CAP_MS) {
    await sleep(clock, CONNECTOR_POLL_MS);
    statuses = await statusesOf(control);
  }
  return statuses;
}

function lateNote(name: string, statuses: readonly ClaudeMcpServerStatus[]): string | null {
  const server = statuses.find((candidate) => candidate.name === name);
  if (server?.status === "connected") return null;
  return server ? connectorStatusErrorText(server) : `${name}: not listed yet`;
}

/** The chosen servers that are not connected after the wait. */
export const lateConnectorNotes = (
  chosen: readonly string[],
  statuses: readonly ClaudeMcpServerStatus[],
): string[] => chosen.map((name) => lateNote(name, statuses)).filter((note): note is string => note !== null);
