import { rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { readFileIfPresent, writeFileAtomic } from "../home/atomic-write";

const PeerSchema = Type.Object({
  /** Where to dial. */
  url: Type.String({ minLength: 1 }),
  /** The peer's name as this node shows it. */
  name: Type.String(),
  /** Set (with `publicKey`) at the first `hello`, or from the pairing link; once set, a different key at it is refused. */
  nodeId: Type.Optional(Type.String()),
  publicKey: Type.Optional(Type.String()),
  /** The node secret (a device of that peer) this node presents when dialling. */
  secret: Type.String({ minLength: 1 }),
  /** 0.1.x only: this node's own name for the hub (`--name`). */
  nodeName: Type.Optional(Type.String()),
});

/** One line of `<home>/peers.json`: a peer this node dials. */
export type Peer = Type.Static<typeof PeerSchema>;

export interface PeersStore {
  /** `[]` when absent or unreadable. Entries that do not match the schema are dropped. */
  read(): Promise<Peer[]>;
  /** Mode 0600, atomic. */
  write(peers: readonly Peer[]): Promise<void>;
}

export const peersFilePath = (home: string): string => join(home, "peers.json");
export const hubFilePath = (home: string): string => join(home, "hub.json");
export const MIGRATED_HUB_FILE = "hub.json.migrated";

export function createFilePeersStore(file: string): PeersStore {
  return {
    async read() {
      const text = await readFileIfPresent(file);
      if (text === undefined) return [];
      try {
        const value: unknown = JSON.parse(text);
        return Array.isArray(value)
          ? value.filter((item): item is Peer => Value.Check(PeerSchema, item))
          : [];
      } catch {
        return [];
      }
    },
    write: (peers) => writeFileAtomic(file, `${JSON.stringify(peers, null, 2)}\n`),
  };
}

interface LegacyHubFile {
  readonly hubUrl: string;
  readonly nodeSecret: string;
  readonly name: string;
  readonly nodeName?: string;
}

function legacyHubOf(value: unknown): LegacyHubFile | undefined {
  const file = value as Partial<LegacyHubFile> | null;
  const ok =
    typeof file?.hubUrl === "string" && typeof file.nodeSecret === "string" && typeof file.name === "string";
  return ok ? (file as LegacyHubFile) : undefined;
}

/**
 * A 0.1.x `<home>/hub.json` is copied into a one-entry `peers.json` (the id is learned at the first `hello`). The
 * old file STAYS, so a downgrade to 0.1.x keeps its link; `tau disconnect` removes both. Does nothing when there is
 * no `hub.json` or a `peers.json` already exists (it is never overwritten). An unreadable `hub.json` is moved aside
 * as `hub.json.migrated`. Returns whether it migrated.
 */
export async function migrateHubFile(home: string): Promise<boolean> {
  const hubFile = hubFilePath(home);
  const text = await readFileIfPresent(hubFile);
  if (text === undefined) return false;
  let hub: LegacyHubFile | undefined;
  try {
    hub = legacyHubOf(JSON.parse(text));
  } catch {
    hub = undefined;
  }
  if (!hub) {
    await rm(join(home, MIGRATED_HUB_FILE), { force: true });
    await rename(hubFile, join(home, MIGRATED_HUB_FILE));
    return false;
  }
  if ((await readFileIfPresent(peersFilePath(home))) !== undefined) return false;
  await createFilePeersStore(peersFilePath(home)).write([
    {
      url: hub.hubUrl,
      name: hub.name,
      secret: hub.nodeSecret,
      ...(hub.nodeName ? { nodeName: hub.nodeName } : {}),
    },
  ]);
  return true;
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** `<home>/machines` (the 0.1.x summary cache) becomes `<home>/nodes`; when `nodes` exists the old one is left alone. */
export async function migrateSummaryDirectory(home: string): Promise<boolean> {
  const from = join(home, "machines");
  const to = join(home, "nodes");
  if ((await exists(to)) || !(await exists(from))) return false;
  await rename(from, to);
  return true;
}
