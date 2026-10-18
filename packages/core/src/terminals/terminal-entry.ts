import type { TerminalAttachment, TerminalHandlers, TerminalInfo } from "@tau/protocol";
import type { TerminalPort } from "../harness/terminal-daemon";
import { createModeTracker, type ModeTracker } from "./mode-tracker";
import { createRingBuffer, type RingBuffer } from "./ring-buffer";

export const REPLAY_FRAME = 64 * 1024;
const RESET = "\x1bc";
const encoder = new TextEncoder();

interface Client {
  readonly handlers: TerminalHandlers;
  size: { cols: number; rows: number } | undefined;
}

export interface TerminalEntry {
  info: TerminalInfo;
  readonly shellName: string;
  readonly port: TerminalPort;
  readonly ring: RingBuffer;
  readonly modes: ModeTracker;
  readonly clients: Client[];
  ptySize: { cols: number; rows: number };
  /** The client whose size the PTY has. */
  owner: Client | undefined;
}

export function createEntry(
  info: TerminalInfo,
  shellName: string,
  port: TerminalPort,
  cols: number,
  rows: number,
) {
  const entry: TerminalEntry = {
    info,
    shellName,
    port,
    ring: createRingBuffer(),
    modes: createModeTracker(),
    clients: [],
    ptySize: { cols, rows },
    owner: undefined,
  };
  return entry;
}

export function receive(entry: TerminalEntry, bytes: Uint8Array): void {
  entry.modes.scan(bytes);
  entry.ring.push(bytes);
  for (const client of [...entry.clients]) client.handlers.onData(bytes);
}

function sendReplay(entry: TerminalEntry, handlers: TerminalHandlers): void {
  handlers.onData(encoder.encode(RESET + entry.modes.prefix()));
  for (const frame of entry.ring.frames(REPLAY_FRAME)) handlers.onData(frame);
}

function applySize(entry: TerminalEntry, size: { cols: number; rows: number }): void {
  if (size.cols === entry.ptySize.cols && size.rows === entry.ptySize.rows) return;
  entry.ptySize = size;
  entry.port.resize(size.cols, size.rows);
}

async function repaintAt(entry: TerminalEntry, size: { cols: number; rows: number }): Promise<void> {
  const job = await entry.port.foreground().catch(() => undefined);
  if (job === undefined || entry.info.status !== "running") return;
  entry.port.resize(size.cols + 1, size.rows);
  entry.port.resize(size.cols, size.rows);
}

function ownerResized(entry: TerminalEntry, client: Client, size: { cols: number; rows: number }): void {
  const first = entry.owner !== client;
  entry.owner = client;
  const equal = size.cols === entry.ptySize.cols && size.rows === entry.ptySize.rows;
  if (first && equal) void repaintAt(entry, size);
  else applySize(entry, size);
}

function newestSized(entry: TerminalEntry): Client | undefined {
  return [...entry.clients].reverse().find((client) => client.size !== undefined);
}

export function attachClient(entry: TerminalEntry, handlers: TerminalHandlers): TerminalAttachment {
  const client: Client = { handlers, size: undefined };
  sendReplay(entry, handlers);
  entry.clients.push(client);
  return {
    status: entry.info.status,
    exitCode: entry.info.exitCode,
    write: (data) => {
      if (entry.info.status === "running") entry.port.write(data);
    },
    resize: (cols, rows) => {
      if (!entry.clients.includes(client) || entry.info.status !== "running") return;
      client.size = { cols, rows };
      if (newestSized(entry) === client) ownerResized(entry, client, client.size);
    },
    detach: () => {
      const index = entry.clients.indexOf(client);
      if (index < 0) return;
      entry.clients.splice(index, 1);
      if (entry.owner !== client) return;
      entry.owner = newestSized(entry);
      if (entry.owner?.size && entry.info.status === "running") applySize(entry, entry.owner.size);
    },
  };
}
