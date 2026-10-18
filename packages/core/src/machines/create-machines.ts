import { type Core, HUB_LINK_NONE, type HubLink } from "@tau/protocol";
import { notImplemented } from "../not-implemented";
import type { MachinesDeps } from "./ports";

/**
 * `Core.machines`. STUB for owner F: the hub registry (register, heartbeat, markOffline, derived status,
 * threadCount, summary cache under `deps.directory/<id>/summary.json`, disconnect revoking the device) is not
 * built yet. `reportLink` and `hubState` work. The contract tag `[machines]` is pending for the real core until F
 * removes it from `PENDING_TAGS` in `core/src/contract.test.ts`; the testkit `fake-machines.ts` is the spec.
 */
export function createMachines(deps: MachinesDeps): Core["machines"] {
  let link: HubLink = HUB_LINK_NONE;
  return {
    list: async () => [],
    rename: async () => {
      throw notImplemented("machines.rename");
    },
    disconnect: async () => {
      throw notImplemented("machines.disconnect");
    },
    hubState: async () => link,
    async disconnectHub() {
      await deps.forgetHub?.();
      link = HUB_LINK_NONE;
      deps.changes.emit({ resource: "machines" });
    },
    reportLink(state) {
      link = state;
      deps.changes.emit({ resource: "machines" });
    },
    register: async () => {
      throw notImplemented("machines.register");
    },
    heartbeat: () => undefined,
    markOffline: () => undefined,
    readSummary: async () => undefined,
    writeSummary: async () => {
      throw notImplemented("machines.writeSummary");
    },
  };
}
