import { rm } from "node:fs/promises";
import { generateNodeKeys, keysMatch, type NodeKeys, nodeIdOf, signPayload } from "@tau/protocol/identity";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { readFileIfPresent, writeFileAtomic } from "../home/atomic-write";

const StoredIdentitySchema = Type.Object({
  version: Type.Literal(1),
  publicKey: Type.String(),
  privateKey: Type.String(),
  createdAt: Type.Number(),
});

/** This node's identity. The private key stays inside this object; core only exposes `sign`. */
export interface NodeIdentity {
  readonly nodeId: string;
  readonly publicKey: string;
  readonly createdAt: number;
  sign(payload: string): string;
}

export interface NodeIdentityStore {
  /** Reads `<home>/node.json`; creates it (Ed25519, 0600, atomic) when absent. Throws for a damaged file (never silently a new id). */
  load(): Promise<NodeIdentity>;
  /** Deletes the file; the next `load` makes a new key and `nodeId`. */
  reset(): Promise<void>;
}

function identityOf(keys: NodeKeys, createdAt: number): NodeIdentity {
  return {
    nodeId: nodeIdOf(keys.publicKey),
    publicKey: keys.publicKey,
    createdAt,
    sign: (payload) => signPayload(keys, payload),
  };
}

export function createNodeIdentityStore(file: string, now: () => number = Date.now): NodeIdentityStore {
  return {
    async load() {
      const text = await readFileIfPresent(file);
      if (text !== undefined) {
        let stored: unknown;
        try {
          stored = JSON.parse(text);
        } catch {
          stored = undefined;
        }
        if (!Value.Check(StoredIdentitySchema, stored) || !keysMatch(stored)) {
          throw new Error(`${file} is damaged. Run \`tau nodes reset-identity\` to make a new identity.`);
        }
        return identityOf(stored, stored.createdAt);
      }
      const keys = generateNodeKeys();
      const createdAt = now();
      await writeFileAtomic(file, `${JSON.stringify({ version: 1, ...keys, createdAt }, null, 2)}\n`);
      return identityOf(keys, createdAt);
    },
    reset: () => rm(file, { force: true }),
  };
}
