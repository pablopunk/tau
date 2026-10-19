import type { Core } from "@tau/protocol";
import { generateNodeKeys, type NodeKeys, nodeIdOf, signPayload } from "@tau/protocol/identity";
import { createFakeCore, type FakeCore, type FakeCoreOptions } from "@tau/testkit";

export interface IdentityCore {
  readonly core: FakeCore;
  readonly keys: NodeKeys;
  readonly nodeId: string;
}

/** A fake core whose `nodes.self` and `nodes.sign` use a real Ed25519 key, so real handshakes verify. */
export function createIdentityCore(
  name: string,
  options: FakeCoreOptions = {},
  keys = generateNodeKeys(),
): IdentityCore {
  const core = createFakeCore({ configured: true, speed: 1000, ...options });
  const nodes: Core["nodes"] = core.nodes;
  const fakeSelf = nodes.self.bind(nodes);
  nodes.self = async () => ({
    ...(await fakeSelf()),
    nodeId: nodeIdOf(keys.publicKey),
    publicKey: keys.publicKey,
    name,
  });
  nodes.sign = async (payload) => signPayload(keys, payload);
  return { core, keys, nodeId: nodeIdOf(keys.publicKey) };
}
