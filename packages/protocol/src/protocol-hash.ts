/**
 * The `protocolVersion` of this build: a hash of the routes table, the machine-link frames and the `Change` union.
 * `protocol-version.test.ts` fails when the surface changes and this value does not; run
 * `mise exec -- pnpm --filter @tau/protocol bump-protocol` to rewrite it.
 */
export const PROTOCOL_VERSION = "37f1a9deb97bc229d8664d17e5bc041a";
