import { arch, hostname, platform } from "node:os";
import {
  type Core,
  type HubLinkStateName,
  LINK_CLOSE_UPDATE_REQUIRED,
  type MachineHello,
  PROTOCOL_VERSION,
} from "@tau/protocol";
import WebSocket from "ws";
import { cliVersion } from "../version";
import type { HubFile, HubFileStore } from "./hub-file";
import { linkUrlOf, originOf } from "./link-endpoint";
import { runLinkSession } from "./link-session";
import { fileKey, hubLinkOf } from "./link-state";

/** Frozen in Phase 0: `serve.ts` calls exactly this. */
export interface LinkClientOptions {
  /** The port this server is bound to: the link client calls its own server on loopback. */
  readonly port: number;
  /** The master token, sent as `Authorization: Bearer`, with `Host: 127.0.0.1:<port>` and no Origin. */
  readonly token: string;
  readonly hubFile: HubFileStore;
  /** The client reports its state with `core.machines.reportLink(state)`. */
  readonly core: Core;
}

export interface LinkClient {
  /** Closes the hub socket and every in-flight stream. */
  stop(): Promise<void>;
}

export type StartLinkClient = (options: LinkClientOptions) => LinkClient;

export interface LinkTuning {
  readonly pollMs: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  readonly pingMs?: number;
  readonly idleMs?: number;
  /** Failed attempts in a row before the state is `unreachable`. */
  readonly unreachableAfter: number;
  readonly log: (message: string) => void;
}

const DEFAULT_TUNING: LinkTuning = {
  pollMs: 1000,
  backoffBaseMs: 1000,
  backoffMaxMs: 30_000,
  unreachableAfter: 3,
  log: (message) => console.log(`[link] ${message}`),
};

type Outcome = "ended" | "failed" | "refused" | "update-required";
const REFUSED_STATUSES = new Set([401, 403]);
const REFUSED_CLOSE = 1008;

async function helloOf(file: HubFile, core: Core): Promise<MachineHello> {
  const threadCount = await core.conversations.listAll().then(
    (all) => all.length,
    () => 0,
  );
  return {
    name: file.machineName ?? hostname(),
    os: `${platform()} ${arch()}`,
    tauVersion: safeVersion(),
    protocolVersion: PROTOCOL_VERSION,
    threadCount,
  };
}

function safeVersion(): string {
  try {
    return cliVersion();
  } catch {
    return "unknown";
  }
}

/** Reads `hub.json` (and watches it by polling, so `tau connect` and `tau disconnect` need no restart) and keeps the hub link up. */
export function startLinkClientWith(options: LinkClientOptions, tuning: LinkTuning): LinkClient {
  const { core, hubFile } = options;
  let stopped = false;
  let wakeSleeper: (() => void) | undefined;
  /** A pause that `stop()` cuts short, so shutting down never waits for a poll tick. */
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wakeSleeper = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  let active: WebSocket | undefined;
  let lastState: HubLinkStateName = "none";
  let since = Date.now();

  const report = (state: HubLinkStateName, file: HubFile | undefined) => {
    if (state !== lastState) since = Date.now();
    lastState = state;
    core.machines.reportLink(hubLinkOf(state, file, since));
  };

  async function waitFor(ms: number, key: string): Promise<void> {
    const deadline = Date.now() + ms;
    while (!stopped && Date.now() < deadline) {
      await sleep(Math.min(tuning.pollMs, Math.max(1, deadline - Date.now())));
      if (fileKey(await hubFile.read()) !== key) return;
    }
  }

  function dial(file: HubFile): Promise<{ outcome: Outcome; linked: boolean }> {
    return new Promise((resolve) => {
      const key = fileKey(file);
      let linked = false;
      const socket = new WebSocket(linkUrlOf(file.hubUrl), {
        headers: { authorization: `Bearer ${file.machineSecret}`, origin: originOf(file.hubUrl) },
        handshakeTimeout: 15_000,
      });
      active = socket;
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve({ outcome: REFUSED_STATUSES.has(response.statusCode ?? 0) ? "refused" : "failed", linked });
      });
      socket.once("error", () => resolve({ outcome: "failed", linked }));
      socket.once("open", () => {
        void helloOf(file, core).then(async (hello) => {
          if (socket.readyState !== socket.OPEN) return resolve({ outcome: "failed", linked });
          linked = true;
          report("linked", file);
          const session = runLinkSession(socket, {
            port: options.port,
            token: options.token,
            hello,
            ...tuning,
          });
          const watch = setInterval(async () => {
            if (fileKey(await hubFile.read()) !== key) session.close();
          }, tuning.pollMs);
          const end = await session.ended;
          clearInterval(watch);
          resolve({ outcome: outcomeOf(end), linked });
        });
      });
    });
  }

  const outcomeOf = ({ code }: { code: number; reason?: string }): Outcome => {
    if (code === REFUSED_CLOSE) return "refused";
    return code === LINK_CLOSE_UPDATE_REQUIRED ? "update-required" : "ended";
  };

  async function loop(): Promise<void> {
    let attempts = 0;
    let wasLinked = false;
    while (!stopped) {
      const file = await hubFile.read();
      if (!file) {
        if (lastState !== "none") report("none", undefined);
        attempts = 0;
        wasLinked = false;
        await sleep(tuning.pollMs);
        continue;
      }
      if (lastState === "none") report("connecting", file);
      const { outcome, linked } = await dial(file);
      active = undefined;
      if (stopped) return;
      wasLinked ||= linked;
      attempts = linked ? 1 : attempts + 1;
      const key = fileKey(file);
      if (outcome === "refused") {
        report("refused", file);
        await waitFor(Number.POSITIVE_INFINITY, key);
        attempts = 0;
        continue;
      }
      if (outcome === "update-required") report("update-required", file);
      else if (attempts >= tuning.unreachableAfter) report("unreachable", file);
      else report(wasLinked ? "reconnecting" : "connecting", file);
      const delay = Math.min(tuning.backoffMaxMs, tuning.backoffBaseMs * 2 ** Math.max(0, attempts - 1));
      await waitFor(delay, key);
    }
  }

  const running = loop().catch((error: unknown) => {
    tuning.log(`link client stopped: ${error instanceof Error ? error.message : String(error)}`);
  });

  return {
    async stop() {
      stopped = true;
      wakeSleeper?.();
      const socket = active;
      if (socket) {
        socket.close(1000, "stopping");
        setTimeout(() => socket.terminate(), 1000).unref();
      }
      await running;
    },
  };
}

export const startLinkClient: StartLinkClient = (options) => startLinkClientWith(options, DEFAULT_TUNING);
