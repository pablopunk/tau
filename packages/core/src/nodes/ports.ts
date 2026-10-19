import type { AccessService } from "../access/create-access";
import type { ChangeEmitter } from "../change-emitter";
import type { NodeIdentity } from "../identity/node-identity";
import type { PeersStore } from "../peers/peers-store";

/** What `createNodes` needs. Frozen in Step 1 foundation; owner A fills the behaviour behind it. */
export interface NodesDeps {
  /** `<home>/nodes`: `<id>/summary.json` lives here. */
  readonly directory: string;
  readonly now: () => number;
  readonly changes: ChangeEmitter;
  /** Accepted peers are node devices of the access store: rename, revoke and the identity binding go through it. */
  readonly access: Pick<
    AccessService,
    "listDevices" | "renameDevice" | "revokeDevice" | "bindNodeIdentity" | "findNodeDevice"
  >;
  /** Dialled peers: `<home>/peers.json`. */
  readonly peers: PeersStore;
  /** This node's current identity (replaced live by `resetIdentity`). */
  readonly identity: () => NodeIdentity;
  /** Deletes `node.json` and makes a new identity that `identity()` then returns. */
  readonly resetIdentity: () => Promise<void>;
  /** This tau's protocol hash; a node with another one is `update-required`. */
  readonly protocolVersion: string;
  /** The hash of the base link frames: two nodes with different ones may not link. */
  readonly linkProtocol: string;
  readonly tauVersion: string;
  /** What this node calls itself; the machine's host name when absent. */
  readonly name?: string;
}
