/**
 * The `protocolVersion` of this build: a hash of the routes table, the node-link frames and the `Change` union.
 * `protocol-version.test.ts` fails when the surface changes and this value does not; run
 * `mise exec -- pnpm --filter @tau/protocol bump-protocol` to rewrite it.
 */
export const PROTOCOL_VERSION = "afffd3962b2b71f5bad23d71bf2fd19e";
/**
 * The `linkProtocol` of this build: a hash of the BASE link frames only. It decides whether two nodes may link at all
 * (a mismatch closes the link with 4001); `PROTOCOL_VERSION` only drives "Update tau" and whether the web opens a node's API.
 * Bumped by the same `bump-protocol` command.
 */
export const LINK_PROTOCOL = "763cdc1b5518bd51f1889ff0879daaf0";
