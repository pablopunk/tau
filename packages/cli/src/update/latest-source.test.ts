import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeHooksAllowed } from "./fake-hooks";
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
