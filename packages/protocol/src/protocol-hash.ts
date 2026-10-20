/**
 * The `protocolVersion` of this build: a hash of the routes table, the node-link frames and the `Change` union.
 * `protocol-version.test.ts` fails when the surface changes and this value does not; run
 * `mise exec -- pnpm --filter @tau/protocol bump-protocol` to rewrite it.
 */
export const PROTOCOL_VERSION = "a4ca8951335bf14df9fa65e80ff19c5a";
/**
 * The `linkProtocol` of this build: a hash of the BASE link frames only. It decides whether two nodes may link at all
 * (a mismatch closes the link with 4001); `PROTOCOL_VERSION` only drives "Update tau" and whether the web opens a node's API.
 * Bumped by the same `bump-protocol` command.
 */
export const LINK_PROTOCOL = "763cdc1b5518bd51f1889ff0879daaf0";
