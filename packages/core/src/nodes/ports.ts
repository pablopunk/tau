import type { AccessService } from "../access/create-access";
import type { ChangeEmitter } from "../change-emitter";

/** What owner F's registry needs. Frozen in Phase 0. */
export interface NodesDeps {
  /** `<home>/nodes`: `<id>/summary.json` lives here. */
  readonly directory: string;
  readonly now: () => number;
  readonly changes: ChangeEmitter;
  /** Nodes are devices of kind `node`: rename and revoke go through the access store. */
  readonly access: Pick<AccessService, "listDevices" | "renameDevice" | "revokeDevice">;
  /** Deletes this tau's `hub.json` (supplied by the CLI); absent in tests. */
  readonly forgetHub?: () => Promise<void>;
  /** This tau's protocol hash; a node with another one is `update-required`. */
  readonly protocolVersion: string;
}
