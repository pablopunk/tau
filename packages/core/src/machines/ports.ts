import type { AccessService } from "../access/create-access";
import type { ChangeEmitter } from "../change-emitter";

/** What owner F's registry needs. Frozen in Phase 0. */
export interface MachinesDeps {
  /** `<home>/machines`: `<id>/summary.json` lives here. */
  readonly directory: string;
  readonly now: () => number;
  readonly changes: ChangeEmitter;
  /** Machines are devices of kind `machine`: rename and revoke go through the access store. */
  readonly access: Pick<AccessService, "listDevices" | "renameDevice" | "revokeDevice">;
  /** Deletes this tau's `hub.json` (supplied by the CLI); absent in tests. */
  readonly forgetHub?: () => Promise<void>;
  /** This tau's protocol hash; a machine with another one is `update-required`. */
  readonly protocolVersion: string;
}
