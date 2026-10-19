import { describe, expect, it } from "vitest";
import { compareVersions, isBehind, isPlainVersion } from "./versions";

describe("compareVersions", () => {
  it("orders releases and puts a prerelease below its release", () => {
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(() => compareVersions("x", "1.0.0")).toThrow();
  });
});

describe("isPlainVersion", () => {
  it("accepts only x.y.z", () => {
    expect(isPlainVersion("1.2.3")).toBe(true);
    expect(isPlainVersion("1.2.3-beta")).toBe(false);
  });
});

describe("isBehind", () => {
  it("is true only when current is older", () => {
    expect(isBehind("0.1.0", "0.1.2")).toBe(true);
    expect(isBehind("0.1.2", "0.1.2")).toBe(false);
    expect(isBehind("0.2.0", "0.1.2")).toBe(false);
    expect(isBehind("1.0.0-beta.1", "1.0.0")).toBe(true);
  });
  it("is undefined on empty or garbage", () => {
    expect(isBehind("", "0.1.2")).toBeUndefined();
    expect(isBehind("0.1.0", "")).toBeUndefined();
    expect(isBehind("dev", "0.1.2")).toBeUndefined();
  });
});
