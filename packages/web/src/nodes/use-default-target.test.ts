import { describe, expect, it } from "vitest";
import { firstWithProvider } from "./use-default-target";

describe("firstWithProvider", () => {
  const others = [
    { id: "a", hasProvider: false },
    { id: "b", hasProvider: true },
    { id: "c", hasProvider: true },
  ];
  it("keeps this node when it has a provider", () => {
    expect(firstWithProvider(true, others)).toBeUndefined();
  });
  it("picks the first other node with a provider", () => {
    expect(firstWithProvider(false, others)).toBe("b");
  });
  it("picks none when nobody has one", () => {
    expect(firstWithProvider(false, [{ id: "a", hasProvider: false }])).toBeUndefined();
  });
});
