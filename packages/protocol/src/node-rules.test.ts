import { describe, expect, it } from "vitest";
import { alreadyLinkedRefusal, selfLinkRefusal } from "./node-rules";

describe("node link rules", () => {
  it("refuses a link to oneself, never to another node", () => {
    expect(selfLinkRefusal("abc", "abc")).toMatch(/itself/);
    expect(selfLinkRefusal("abc", "xyz")).toBeUndefined();
    expect(selfLinkRefusal("abc", undefined)).toBeUndefined();
  });

  it("refuses a node that is already linked", () => {
    expect(alreadyLinkedRefusal(true)).toMatch(/already linked/);
    expect(alreadyLinkedRefusal(false)).toBeUndefined();
  });
});
