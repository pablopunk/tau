import { describe, expect, it } from "vitest";
import { machineAssetUrl } from "./paths";

describe("machineAssetUrl", () => {
  it("leaves the hub's own URLs alone", () => {
    expect(machineAssetUrl("/api/projects/p1/icon?v=auto")).toBe("/api/projects/p1/icon?v=auto");
  });

  it("routes a linked machine's URL through the hub proxy", () => {
    expect(machineAssetUrl("/api/projects/p1/icon?v=auto", "m 1")).toBe(
      "/api/m/m%201/api/projects/p1/icon?v=auto",
    );
  });

  it("keeps absolute URLs", () => {
    expect(machineAssetUrl("https://x.test/a.png", "m1")).toBe("https://x.test/a.png");
  });
});
