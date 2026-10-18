import { AppError, type Core } from "@tau/protocol";
import type { AccessDeps } from "./ports";

/** What `Core.access` is, plus what the remote service needs when a URL dies. */
export type AccessService = Core["access"] & {
  /** Removes every device and machine (their cookies and links belong to the old host). */
  clearAll(): Promise<void>;
};

const unavailable = () => new AppError("invalid_request", "Linking devices is not available yet.");

/** Phase 0 stub: nobody is linked and nothing can be linked. Owner A replaces the body. */
export function createAccess(deps: AccessDeps): AccessService {
  return {
    verifyDevice: async () => undefined,
    verifyMachine: async () => undefined,
    touch: () => undefined,
    listDevices: async () => [],
    renameDevice: async (id) => {
      throw new AppError("not_found", `No device ${id}.`);
    },
    revokeDevice: async () => undefined,
    signOutAll: async () => undefined,
    mintPairing: async () => {
      throw unavailable();
    },
    redeemPairing: async () => {
      throw new AppError("unauthorized", "That code did not work.");
    },
    clearAll: async () => {
      await deps.store.write([]);
      deps.announce();
    },
  };
}
