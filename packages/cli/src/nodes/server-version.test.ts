import { describe, expect, it } from "vitest";
import { isOlderVersion, olderServerRefusal } from "./server-version";

describe("server version", () => {
  it("compares major.minor.patch numerically", () => {
    expect(isOlderVersion("0.1.2", "0.2.2")).toBe(true);
    expect(isOlderVersion("0.2.10", "0.2.9")).toBe(false);
    expect(isOlderVersion("0.2.2", "0.2.2")).toBe(false);
    expect(isOlderVersion("1.0.0", "0.9.9")).toBe(false);
  });

  it("refuses only an older running server, with the update command", () => {
    expect(olderServerRefusal(undefined, "0.2.2")).toBeUndefined();
    expect(olderServerRefusal("0.2.2", "0.2.2")).toBeUndefined();
    expect(olderServerRefusal("0.3.0", "0.2.2")).toBeUndefined();
    expect(olderServerRefusal("0.1.2", "0.2.2")).toContain("npm i -g @pablopunk/tau@latest && tau restart");
  });
});
