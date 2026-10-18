import { hostname } from "node:os";
import type { Device, MintedPairing, RemoteStatus } from "@tau/protocol";
import QRCode from "qrcode";
import { CliExit, EXIT_TIMEOUT, usageError } from "./cli-exit";
import { callRoute, discoverServer, type Server } from "./client";
import type { CommandEnv } from "./command-env";

export const REMOTE_WAIT_MS = 12 * 60 * 1000;
export const LINK_POLL_MS = 2000;
const REMOTE_POLL_MS = 3000;
const PROGRESS_EVERY_MS = 15_000;

export const FULL_POWER_WARNING =
  "A linked device gets full power over this computer: agents, terminals and your files. Share this only with yourself.";

export function parsePairArgs(argv: readonly string[]): { name: string } {
  let name: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    if (token === "--name" && argv[index + 1] !== undefined) name = argv[++index];
    else if (token.startsWith("--name=")) name = token.slice("--name=".length);
    else throw usageError(`Unknown argument "${token}". Usage: tau pair [--name <label>]`);
  }
  return { name: name?.trim() || hostname() };
}

export const groupShortCode = (code: string): string => code.match(/.{1,4}/g)?.join(" ") ?? code;

const remoteOf = (server: Server, env: CommandEnv) =>
  callRoute(server, "getRemoteStatus", {}, env) as Promise<RemoteStatus>;

async function waitUntilOnline(server: Server, env: CommandEnv, first: RemoteStatus): Promise<RemoteStatus> {
  const deadline = env.now() + REMOTE_WAIT_MS;
  let status = first;
  let lastProgress = env.now();
  let lastMessage: string | null = null;
  while (status.state !== "online") {
    if (status.state === "error" || status.state === "off") {
      throw new CliExit(1, `Remote access did not start: ${status.message ?? status.state}`);
    }
    if (env.now() >= deadline) {
      throw new CliExit(
        EXIT_TIMEOUT,
        "Remote access is still starting. It keeps going in the server: run `tau pair` again in a few minutes.",
      );
    }
    if (status.message && status.message !== lastMessage) {
      lastMessage = status.message;
      env.stdout(status.message);
    } else if (env.now() - lastProgress >= PROGRESS_EVERY_MS) {
      lastProgress = env.now();
      env.stdout(`Still ${status.state}… (this takes a few minutes)`);
    }
    await env.sleep(REMOTE_POLL_MS);
    status = await remoteOf(server, env);
  }
  return status;
}

/** Turns remote on when needed and waits until the tunnel is online. */
export async function ensureRemoteOnline(server: Server, env: CommandEnv): Promise<void> {
  let status = await remoteOf(server, env);
  if (status.state === "online") return;
  if (status.state === "off") {
    env.stdout("Remote access is off. Turning it on: the first time takes a few minutes, please wait.");
    status = (await callRoute(server, "enableRemote", {}, env)) as RemoteStatus;
  } else {
    env.stdout("Remote access is starting: this takes a few minutes.");
  }
  await waitUntilOnline(server, env, status);
}

export function nameInLink(link: string, name: string): string {
  return `${link}.${encodeURIComponent(name)}`;
}

async function printPairing(env: CommandEnv, pairing: MintedPairing, link: string): Promise<void> {
  const qr = await QRCode.toString(link, { type: "terminal", small: true });
  env.stdout(`\n${qr}`);
  env.stdout(`Open this link on the device:\n  ${link}\n`);
  env.stdout(`Or open the same site and type this code:  ${groupShortCode(pairing.shortCode)}\n`);
  env.stdout(FULL_POWER_WARNING);
  const minutes = Math.max(1, Math.round((pairing.expiresAt - env.now()) / 60_000));
  env.stdout(
    `The code works once and expires in ${minutes} minutes. Waiting for the device… (Ctrl+C to stop)`,
  );
}

const listDevices = (server: Server, env: CommandEnv) =>
  callRoute(server, "listDevices", {}, env) as Promise<Device[]>;

async function waitForLinkedDevice(
  server: Server,
  env: CommandEnv,
  knownIds: ReadonlySet<string>,
  expiresAt: number,
): Promise<void> {
  while (env.now() < expiresAt) {
    await env.sleep(LINK_POLL_MS);
    const fresh = (await listDevices(server, env)).find((device) => !knownIds.has(device.id));
    if (fresh) return env.stdout(`Linked: ${fresh.name}`);
  }
  throw new CliExit(
    EXIT_TIMEOUT,
    "The code expired before a device linked. Run `tau pair` again for a new one.",
  );
}

export async function runPairFlow(argv: readonly string[], env: CommandEnv): Promise<void> {
  const { name } = parsePairArgs(argv);
  const server = await discoverServer(env);
  await ensureRemoteOnline(server, env);
  const known = new Set((await listDevices(server, env)).map((device) => device.id));
  const pairing = (await callRoute(
    server,
    "mintPairing",
    { query: { kind: "device" } },
    env,
  )) as MintedPairing;
  if (pairing.link === null) throw new CliExit(1, "Remote access has no URL yet. Try again in a moment.");
  await printPairing(env, pairing, nameInLink(pairing.link, name));
  await waitForLinkedDevice(server, env, known, pairing.expiresAt);
}
