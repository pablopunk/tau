import { describe, expect, it } from "vitest";
import { supportsToolSearch } from "./tool-search";

describe("supportsToolSearch", () => {
  it("is on for current models, haiku included", () => {
    for (const model of ["sonnet", "opus", "haiku", "claude-haiku-4-5-20251001", "claude-opus-4-5"])
      expect(supportsToolSearch(model)).toBe(true);
  });

  it("is off for legacy Claude 3 models", () => {
    for (const model of ["claude-3-5-haiku-latest", "claude-3-7-sonnet-latest", "claude-3-opus-20240229"])
      expect(supportsToolSearch(model)).toBe(false);
  });
});
