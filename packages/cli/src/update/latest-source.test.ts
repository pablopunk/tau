import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeHooksAllowed, versionOf } from "./fake-hooks";
import { latestVersionSource } from "./latest-source";

const scratch = () => mkdtempSync(join(tmpdir(), "tau-fake-"));

describe("latestVersionSource", () => {
  it("answers TAU_FAKE_LATEST for a home under the temp dir", async () => {
    expect(await latestVersionSource({ TAU_FAKE_LATEST: "9.9.9" }, scratch())()).toBe("9.9.9");
  });
});

describe("fakeHooksAllowed", () => {
  it("allows only homes under the temp dir", () => {
    expect(fakeHooksAllowed(scratch())).toBe(true);
    expect(fakeHooksAllowed("/Users/someone/.tau")).toBe(false);
    expect(fakeHooksAllowed(undefined)).toBe(false);
    expect(fakeHooksAllowed(`${tmpdir()}-evil/x`)).toBe(false);
  });
});

describe("versionOf", () => {
  it("honours TAU_FAKE_VERSION only for a home under the temp dir", () => {
    const env = { TAU_FAKE_VERSION: "9.9.9" };
    expect(versionOf("1.0.0", scratch(), env)).toBe("9.9.9");
    expect(versionOf("1.0.0", "/home/u/.tau", env)).toBe("1.0.0");
    expect(versionOf("1.0.0", scratch(), {})).toBe("1.0.0");
  });
});
