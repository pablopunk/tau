import { machineApiPrefix } from "@tau/protocol";
import { createHttpTransport } from "./http";
import { createLazyTransport } from "./lazy";
import type { Transport } from "./types";

/**
 * The transport of one linked machine: every request, `/api/live` socket and stream goes through the hub's proxy,
 * `/api/m/<machineId>/api/...`. The hub's own machine uses `createHttpTransport()` with no prefix.
 */
export function createMachineTransport(machineId: string): Transport {
  if (import.meta.env.VITE_FAKE) {
    return createLazyTransport(() =>
      import("./fake").then((module) => module.createDefaultFakeMachineTransport(machineId)),
    );
  }
  return createHttpTransport({ prefix: machineApiPrefix(machineId) });
}
