import { test } from "@playwright/test";

/**
 * MVP13 Step 2 Phase 0 pins as written skeletons (acceptance numbers from MVP13.md). The Step 2 integration
 * agent fills them with three real built servers on scratch homes and random loopback ports (see
 * `nodes-support.ts`, `restartable-server.ts`) once owners E, F, G, H are merged, and replaces `fixme` by `test`.
 * Pins r2, r3, r5 and the replay/skew half of r7 run today as unit tests (`packages/protocol/src/routing.test.ts`,
 * `identity/directory-signatures.test.ts`).
 */
test.describe("MVP13 Step 2 pins (skeletons)", () => {
  test.fixme("r1: A sees C through B within 20 s; GET, terminal stream and 42 MB body reach C with the right ids on every hop", async () => {
    // Chain A-B-C on three scratch homes (A pairs B, B pairs C).
    // - A lists C (hops 2, "via B") within 20 s of the link coming up.
    // - GET /api/n/<C>/api/health from A; a terminal stream and a 42 MB body (sha256 equal) from A to C.
    // - Kill B cleanly: C is offline on A within 5 s. SIGSTOP B (power loss): offline within 60 s.
    // - Add a link A-C first: C stays reachable after B dies.
  });

  test.fixme("r4: credit across two hops: a stalled far end stalls only its stream", async () => {
    // A 20 MB response nobody reads from C through B: B buffers at most one 1 MiB window for that stream;
    // 20 other requests through the same relay finish normally; `ready` is forwarded; 60 s without credit closes 1013 on that hop and the close propagates.
  });

  test.fixme("r6: expel on chain and triangle reaches every node within 5 s; the target is cut off", async () => {
    // `expel C` on A: B and C's other links learn it within 5 s; C cannot relink (4003), route or originate requests;
    // its open shell stream closes on the destination; an offline node learns the tombstone at reconnect BEFORE accepting routes;
    // cut vertex (A-C-B) and offline-with-only-C show "not confirmed"; mutual expel converges to {B, C};
    // forged (bad signature, wrong by, signer outside the group) and replayed expels are ignored;
    // a neighbour's announce cannot quarantine a node; reset-identity then rejoin with a new pairing code works.
  });

  test.fixme("r7: a skewed clock shows 'clock skew with <node>'; a replay inside the window is refused", async () => {
    // Start C with the clock shifted by more than 120 s (via TAU_FAKE_CLOCK_OFFSET_MS, added by owner F or the integrator):
    // routed requests from A to C are refused and the UI shows "clock skew with C". A byte-identical replayed frame inside ±120 s is refused.
  });
});
