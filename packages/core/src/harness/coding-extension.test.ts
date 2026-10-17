import { describe, expect, it } from "vitest";
import { MENTIONS_PROMPT } from "./coding-extension";

describe("coding extension prompt", () => {
  it("explains mentions", () => {
    expect(MENTIONS_PROMPT).toContain("@path");
  });
});
