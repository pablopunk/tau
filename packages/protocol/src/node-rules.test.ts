import { describe, expect, it } from "vitest";
import { acceptLinkRefusal, alreadyLinkedRefusal, connectRefusal } from "./node-rules";

describe("node link refusal rules", () => {
  it("refuses links to a tau that has a hub, whatever the link state", () => {
    for (const state of [
      "connecting",
      "linked",
      "reconnecting",
      "unreachable",
      "update-required",
      "refused",
    ] as const) {
      expect(acceptLinkRefusal({ state }), state).toMatch(/linked to a hub/);
    }
    expect(acceptLinkRefusal({ state: "none" })).toBeUndefined();
  });

  it("refuses tau connect while nodes are linked to this tau", () => {
    expect(connectRefusal(1)).toMatch(/cannot link to a hub/);
    expect(connectRefusal(0)).toBeUndefined();
  });

  it("refuses a second hub", () => {
    expect(alreadyLinkedRefusal(true)).toMatch(/tau disconnect/);
    expect(alreadyLinkedRefusal(false)).toBeUndefined();
  });
});
