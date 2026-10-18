import {
  create,
  type OpenTunnelConnection,
  type OpenTunnelPromiseClient,
  OpenTunnelStorage,
} from "@opentunnel/client";
import { neutralFailure, OFFLINE_TEXT } from "./neutral-text";
import type { RemoteAdapter, RemoteAdapterDeps } from "./ports";
import { createStatusMachine, timeoutSchedule } from "./status-machine";
import { createTunnelProfiles, profileNameFor } from "./tunnel-profiles";

/** The only file that may import `@opentunnel/client` (Biome `noRestrictedImports`). */

const OFFLINE_DEADLINE_MS = 15_000;
const REMOVAL_RETRY_MS = 5 * 60 * 1000;

/** The SDK's file store rooted at `directory` (`<directory>/opentunnel/<profile>/…`, no `~/.local`). */
export function createTunnelStorage(directory: string): OpenTunnelStorage {
  const env = { XDG_DATA_HOME: directory, XDG_CONFIG_HOME: directory, XDG_STATE_HOME: directory };
  return OpenTunnelStorage.xdg({ env, home: directory });
}

export function createTunnelClient(
  directory: string,
  storage = createTunnelStorage(directory),
): OpenTunnelPromiseClient {
  return create({ store: storage });
}

export function createOpenTunnelAdapter(deps: RemoteAdapterDeps): RemoteAdapter {
  const schedule = deps.schedule ?? timeoutSchedule;
  const storage = createTunnelStorage(deps.directory);
  const client = createTunnelClient(deps.directory, storage);
  const profile = profileNameFor(deps.directory);
  const profiles = createTunnelProfiles(profile, storage, client);
  const machine = createStatusMachine(deps.now, schedule);
  let generation = 0;
  let connection: OpenTunnelConnection | undefined;
  let abort: AbortController | undefined;
  let cancelDeadline: (() => void) | undefined;
  let cancelRetry: (() => void) | undefined;

  const urlOf = (hostname: string) => `https://${hostname}`;

  async function retryRemovals(): Promise<void> {
    cancelRetry?.();
    const left = await profiles.removeOld().catch(() => 1);
    machine.setPendingRemoval(left > 0);
    if (left > 0) cancelRetry = schedule(() => void retryRemovals(), REMOVAL_RETRY_MS);
  }

  async function pump(live: OpenTunnelConnection, run: number): Promise<void> {
    for await (const event of live.events) {
      if (run !== generation) return;
      if (event.type === "connected") {
        machine.set("online", { url: urlOf(live.tunnel.hostname) });
        void retryRemovals();
      } else if (event.type === "disconnected" || event.type === "reconnecting") {
        machine.set("reconnecting");
      } else if (event.type === "stopped") {
        machine.set("error", { message: neutralFailure(event.error) });
      }
    }
  }

  async function connect(run: number): Promise<void> {
    const identity =
      (await client.tunnel.get({ profile })) ??
      (await client.tunnel.resume({ profile })) ??
      (await client.tunnel.create({ profile }));
    if (run !== generation) return;
    const url = urlOf(identity.hostname);
    machine.set("starting", { url });
    const target = await deps.tunnelTarget();
    abort = new AbortController();
    cancelDeadline = schedule(() => {
      if (run === generation && machine.status().state === "starting")
        machine.set("error", { url, message: OFFLINE_TEXT });
    }, OFFLINE_DEADLINE_MS);
    const live = await client.tunnel.connect({
      profile,
      routes: { "@": { target, proxyProtocol: "v2" } },
      signal: abort.signal,
    });
    cancelDeadline();
    if (run !== generation) return void (await live.close());
    connection = live;
    machine.set("online", { url });
    void pump(live, run).catch(() => undefined);
  }

  function startInBackground(): void {
    const run = ++generation;
    connect(run).catch((error: unknown) => {
      if (run === generation) machine.set("error", { message: neutralFailure(error) });
    });
  }

  async function stopConnection(): Promise<void> {
    generation += 1;
    cancelDeadline?.();
    abort?.abort();
    const live = connection;
    connection = undefined;
    await live?.close().catch(() => undefined);
  }

  const active = () => ["starting", "online", "reconnecting"].includes(machine.status().state);

  return {
    status: machine.status,
    onStatus: machine.onStatus,
    async enable() {
      if (active()) return machine.status();
      machine.set("starting", { url: null });
      startInBackground();
      return machine.status();
    },
    async disable() {
      await stopConnection();
      try {
        await client.tunnel.remove({ profile });
      } catch {
        await profiles.retireMain().catch(() => undefined);
        void retryRemovals();
      }
      machine.set("off");
      return machine.status();
    },
    async recreate() {
      await stopConnection();
      await profiles.retireMain();
      machine.setPendingRemoval(true);
      void retryRemovals();
      machine.set("starting", { url: null });
      startInBackground();
      return machine.status();
    },
    async resume({ enabled, holdReason }) {
      void retryRemovals();
      if (holdReason) machine.set("off", { message: holdReason });
      else if (enabled) await this.enable();
    },
    async close() {
      await stopConnection();
      cancelRetry?.();
      await client.dispose();
    },
  };
}
