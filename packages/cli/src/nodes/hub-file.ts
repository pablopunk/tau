import { createFilePeersStore, peersFilePath } from "@tau/core";

/**
 * TRANSITIONAL (MVP13 Step 1 foundation): the 0.1.x one-hub view of `<home>/peers.json`, kept so the old one-way
 * dialler and `tau connect` work on the new store until owner D replaces them with the multi-peer client.
 * `<home>/hub.json` itself is migrated to `peers.json` by core at start (and kept as `hub.json.migrated`).
 * Only the first entry is "the hub".
 */
export interface HubFile {
  readonly hubUrl: string;
  readonly nodeSecret: string;
  /** The hub's name (from the link), shown as "Linked to <name>". */
  readonly name: string;
  /** This node's own name for the hub (`--name`); the hostname when absent. */
  readonly nodeName?: string;
}

export interface HubFileStore {
  /** `undefined` when there is no peer. */
  read(): Promise<HubFile | undefined>;
  /** Puts this peer first (mode 0600, atomic through the peers store). */
  write(file: HubFile): Promise<void>;
  /** Removes the first peer only. Idempotent. */
  delete(): Promise<void>;
}

export function createHubFileStore(home: string): HubFileStore {
  const peers = createFilePeersStore(peersFilePath(home));
  return {
    async read() {
      const [first] = await peers.read();
      if (!first) return undefined;
      return {
        hubUrl: first.url,
        nodeSecret: first.secret,
        name: first.name,
        ...(first.nodeName ? { nodeName: first.nodeName } : {}),
      };
    },
    async write(file) {
      const rest = (await peers.read()).filter((peer) => peer.url !== file.hubUrl);
      await peers.write([
        {
          url: file.hubUrl,
          name: file.name,
          secret: file.nodeSecret,
          ...(file.nodeName ? { nodeName: file.nodeName } : {}),
        },
        ...rest,
      ]);
    },
    async delete() {
      const [, ...rest] = await peers.read();
      await peers.write(rest);
    },
  };
}
