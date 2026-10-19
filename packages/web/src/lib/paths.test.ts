import { describe, expect, it } from "vitest";
import { nodeAssetUrl } from "./paths";

describe("nodeAssetUrl", () => {
  it("leaves the hub's own URLs alone", () => {
    expect(nodeAssetUrl("/api/projects/p1/icon?v=auto")).toBe("/api/projects/p1/icon?v=auto");
  });

  it("routes a linked node's URL through the hub proxy", () => {
    expect(nodeAssetUrl("/api/projects/p1/icon?v=auto", "m 1")).toBe(
      "/api/n/m%201/api/projects/p1/icon?v=auto",
    );
  });

  it("keeps absolute URLs", () => {
    expect(nodeAssetUrl("https://x.test/a.png", "m1")).toBe("https://x.test/a.png");
  });
});
