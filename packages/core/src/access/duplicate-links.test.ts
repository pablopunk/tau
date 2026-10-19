import { describe, expect, it } from "vitest";
import { arbitrateDuplicateLink, type LinkFacts, STALE_LINK_MS } from "./duplicate-links";

const link = (over: Partial<LinkFacts>): LinkFacts => ({
  direction: "accepted",
  diallerId: "bbb",
  secretKey: "s1",
  silentMs: 0,
  ...over,
});

describe("arbitrateDuplicateLink", () => {
  it("(a) the same device secret: the newer link replaces the older, which may redial", () => {
    expect(arbitrateDuplicateLink(link({ silentMs: 40_000 }), link({}))).toEqual({
      case: "reconnect",
      survivor: "incoming",
      loserCode: 1001,
      revokeLoser: false,
    });
  });

  it("(b) a second device for the same node: the live link survives and the new device is revoked", () => {
    const verdict = arbitrateDuplicateLink(link({ silentMs: 1000 }), link({ secretKey: "s2" }));
    expect(verdict).toEqual({
      case: "second-device",
      survivor: "existing",
      loserCode: 4002,
      revokeLoser: true,
    });
  });

  it("(b) a link silent for more than 15 s is replaced, so `tau connect` again repairs it", () => {
    const verdict = arbitrateDuplicateLink(link({ silentMs: STALE_LINK_MS + 1 }), link({ secretKey: "s2" }));
    expect(verdict).toMatchObject({ case: "stale-replaced", survivor: "incoming", revokeLoser: true });
    expect(
      arbitrateDuplicateLink(link({ silentMs: STALE_LINK_MS }), link({ secretKey: "s2" })).survivor,
    ).toBe("existing");
  });

  it("(c) glare: the link whose dialler has the lower nodeId survives; nobody is revoked", () => {
    const low = link({ direction: "dialled", diallerId: "aaa", secretKey: "s1" });
    const high = link({ direction: "accepted", diallerId: "zzz", secretKey: "s2" });
    expect(arbitrateDuplicateLink(low, high)).toEqual({
      case: "glare",
      survivor: "existing",
      loserCode: 4002,
      revokeLoser: false,
    });
    expect(arbitrateDuplicateLink(high, low).survivor).toBe("incoming");
  });

  it("(c) both ends reach the same verdict about the same pair of links", () => {
    // seen from A (id aaa): link1 dialled by A, link2 accepted (dialled by B).
    // seen from B (id zzz): link1 accepted (dialled by A), link2 dialled by B.
    const fromA = arbitrateDuplicateLink(
      link({ direction: "dialled", diallerId: "aaa", secretKey: "s1" }),
      link({ direction: "accepted", diallerId: "zzz", secretKey: "s2" }),
    );
    const fromB = arbitrateDuplicateLink(
      link({ direction: "accepted", diallerId: "aaa", secretKey: "s1" }),
      link({ direction: "dialled", diallerId: "zzz", secretKey: "s2" }),
    );
    expect(fromA.survivor).toBe("existing"); // link1 (dialled by aaa)
    expect(fromB.survivor).toBe("existing"); // link1 (dialled by aaa)
  });
});
