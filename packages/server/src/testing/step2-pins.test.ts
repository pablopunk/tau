import { describe, it } from "vitest";

/** Server-side Phase 0 pins of Step 2 as skeletons. Owner F turns them into tests with `createRelay` over `loopback-node` pairs. */
describe("Step 2 pins (skeletons)", () => {
  it.todo(
    "r2: a forged frame whose trail holds the receiver's id, or whose ttl is 0, dies at the receiver (no frame circulates on a triangle)",
  );
  it.todo(
    "r4: relay forwards a chunk only when the outgoing link has credit; returns credit upstream after sending; at most one 1 MiB window buffered per stream",
  );
  it.todo(
    "r4: 60 s without credit closes the stream 1013 on that hop and the close propagates; 20 other requests on the same relay are unaffected",
  );
  it.todo(
    "r4: ready is forwarded both ways and the 4-byte id of every binary frame is rewritten on each hop",
  );
  it.todo(
    "r6: an expel floods to every link except the source (the target included) BEFORE the link to the target closes 4003",
  );
  it.todo(
    "r6: the destination closes every stream whose origin becomes tombstoned; a relay refuses frames whose trail[0] or origin is tombstoned",
  );
  it.todo(
    "r7: a request whose ts is beyond ±120 s is refused with clock_skew; a replay inside the window is refused",
  );
});
