import type { Core } from "@tau/protocol";
import type { ChangeEmitter } from "../../change-emitter";
import type { NodeIdentity } from "../../identity/node-identity";

/**
 * What the directory needs. FROZEN by the Step 2 foundation; owner E fills the behaviour behind it
 * (`create-directory.ts`). The directory never imports the server and never touches sockets.
 */
export interface DirectoryDeps {
  /** `<home>/expelled.json` (0600, atomic): the signed expel objects, read at start, rewritten on change. */
  readonly expelledFile: string;
  readonly now: () => number;
  readonly changes: ChangeEmitter;
  /** This node's current identity (replaced live by `resetIdentity`). */
  readonly identity: () => NodeIdentity;
  /** Peers and their `hello` data, to name nodes and to mark ghosts. `forget` cuts a tombstoned peer locally (device, `peers.json`, summaries). */
  readonly nodes: Pick<Core["nodes"], "list" | "forget">;
  /** The `boot` counter of the announce sequence is persisted next to `expelled.json` (owner E decides the file). */
  readonly home: string;
}

export interface Directory {
  readonly group: Core["nodes"]["group"];
  directory: Core["nodes"]["directory"];
  expulsions: Core["nodes"]["expulsions"];
  /** After `resetIdentity` or a remote reset: new key, so announces restart and `expelled.json` follows the rule (kept; removed when this node itself was expelled). */
  reset(): Promise<void>;
  /** A peer was disconnected or forgotten here: drop what it announced and its link state (no tombstone). */
  forgetPeer(nodeId: string): void;
  /** The expel that named this node, if any (`NodeSelf.removed`). */
  removal(): { readonly by: string; readonly at: number } | undefined;
}
