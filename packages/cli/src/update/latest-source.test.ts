import { describe, expect, it } from "vitest";
import { latestVersionSource } from "./latest-source";

describe("latestVersionSource", () => {
  it("answers TAU_FAKE_LATEST without npm", async () => {
    expect(await latestVersionSource({ TAU_FAKE_LATEST: "9.9.9" })()).toBe("9.9.9");
  });
});
