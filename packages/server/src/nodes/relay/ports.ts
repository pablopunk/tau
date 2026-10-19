import type { Core, ExpelFrame } from "@tau/protocol";
import type { DeviceSockets } from "../../security/device-sockets";
import type { LinkRegistry } from "../link-registry";

/**
 * What the relay needs. FROZEN by the Step 2 foundation; owner F fills the behaviour behind it
 * (`create-relay.ts`): relay table, id rewrite on binary frames, per-hop credit, `trail`/`ttl`, `originSig`
 * check with a nonce cache, destination filter, close propagation, stream close on tombstone, flooding of
 * `announce`, `expel`, `expel-ack` and `expel-sync`.
 */
export interface RelayDeps {
  readonly core: Core;
  readonly registry: LinkRegistry;
  readonly sockets: DeviceSockets;
  readonly now: () => number;
}

export interface Relay {
  /** Starts the 15 s announce timer and the topology/tombstone subscriptions of `core.nodes.group`. */
  start(): () => void;
  /**
   * `POST /api/nodes/:id/remove` after `group.createExpel`: floods the expel to every link FIRST (target
   * included, so it learns why), then closes 4003 on the link to the target and every relayed stream through it.
   */
  floodExpel(frame: ExpelFrame): Promise<void>;
}
