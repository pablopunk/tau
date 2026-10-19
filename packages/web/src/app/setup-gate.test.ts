import { describe, expect, it } from "vitest";
import { canUseOtherNodes, needsSetup } from "./setup-gate";

describe("needsSetup", () => {
  it("never shows once this node can run threads", () => {
    expect(needsSetup({ canRunThreads: true, setupSkipped: false, knownPeers: 0 })).toBe(false);
  });

  it("shows on a fresh node with no provider, with or without peers, until it is skipped", () => {
    expect(needsSetup({ canRunThreads: false, setupSkipped: false, knownPeers: 0 })).toBe(true);
    expect(needsSetup({ canRunThreads: false, setupSkipped: false, knownPeers: 2 })).toBe(true);
  });

  it("stays skipped while any peer is known, whatever its state", () => {
    expect(needsSetup({ canRunThreads: false, setupSkipped: true, knownPeers: 1 })).toBe(false);
  });

  it("shows again when the skip is set but no peer is left", () => {
    expect(needsSetup({ canRunThreads: false, setupSkipped: true, knownPeers: 0 })).toBe(true);
  });

  it("offers 'Use my other nodes' only when a peer is known", () => {
    expect(canUseOtherNodes(0)).toBe(false);
    expect(canUseOtherNodes(1)).toBe(true);
  });
});
