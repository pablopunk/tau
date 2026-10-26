import { AppError } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import {
  CURRENT_FORMAT,
  checkRuntimeFormat,
  formatForwardGuard,
  READER_FLOOR,
  RUNTIME_FORMAT_FILE,
  RuntimeFormatManifestSchema,
} from "./runtime-format";

const reader = { formatVersion: 2, capabilities: ["a", "b"] };
const manifest = (overrides: Record<string, unknown> = {}) => ({
  formatVersion: 1,
  requiredCapabilities: [],
  writtenAt: 1,
  ...overrides,
});

describe("constants", () => {
  it("names the manifest file only", () => {
    expect(RUNTIME_FORMAT_FILE).toBe("runtime-format.json");
    expect(CURRENT_FORMAT).toEqual({ formatVersion: 1, capabilities: [] });
    expect(READER_FLOOR).toBe(CURRENT_FORMAT);
    expect(RuntimeFormatManifestSchema.type).toBe("object");
  });
});

describe("checkRuntimeFormat", () => {
  it("treats an absent manifest as a pre-native store", () => {
    expect(checkRuntimeFormat(undefined, reader)).toEqual({ ok: true, native: false });
  });

  it.each([
    ["null", null],
    ["string", "x"],
    ["array", []],
    ["empty object", {}],
    ["version zero", manifest({ formatVersion: 0 })],
    ["fractional version", manifest({ formatVersion: 1.5 })],
    ["string version", manifest({ formatVersion: "1" })],
    ["capabilities not an array", manifest({ requiredCapabilities: "a" })],
    ["capability not a string", manifest({ requiredCapabilities: [1] })],
    ["missing writtenAt", { formatVersion: 1, requiredCapabilities: [] }],
  ])("reports corrupt for %s", (_name, value) => {
    const result = checkRuntimeFormat(value, reader);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("corrupt");
  });

  it("reports newer-format when the manifest is ahead of the reader", () => {
    const result = checkRuntimeFormat(manifest({ formatVersion: 3 }), reader);
    expect(result).toMatchObject({ ok: false, reason: "newer-format" });
  });

  it("reports missing-capability and names it", () => {
    const result = checkRuntimeFormat(manifest({ requiredCapabilities: ["a", "z"] }), reader);
    expect(result).toMatchObject({ ok: false, reason: "missing-capability" });
    if (!result.ok) expect(result.detail).toContain("z");
  });

  it("prefers newer-format over missing-capability", () => {
    const result = checkRuntimeFormat(manifest({ formatVersion: 9, requiredCapabilities: ["z"] }), reader);
    expect(result).toMatchObject({ ok: false, reason: "newer-format" });
  });

  it.each([
    [manifest(), reader],
    [manifest({ formatVersion: 2, requiredCapabilities: ["a", "b"] }), reader],
    [manifest(), READER_FLOOR],
  ])("accepts a compatible native manifest", (value, readerValue) => {
    expect(checkRuntimeFormat(value, readerValue)).toEqual({ ok: true, native: true });
  });

  it("never throws on hostile input", () => {
    for (const value of [null, 0, "x", Symbol("s"), () => 1, { formatVersion: Number.NaN }]) {
      expect(() => checkRuntimeFormat(value, reader)).not.toThrow();
    }
  });
});

describe("formatForwardGuard", () => {
  it("does not throw for ok results", () => {
    expect(() => formatForwardGuard(undefined, reader)).not.toThrow();
    expect(() => formatForwardGuard(manifest(), reader)).not.toThrow();
  });

  it.each([
    ["corrupt", { nope: true }],
    ["newer-format", manifest({ formatVersion: 5 })],
    ["missing-capability", manifest({ requiredCapabilities: ["z"] })],
  ])("throws forbidden AppError mentioning %s", (reason, value) => {
    let thrown: unknown;
    try {
      formatForwardGuard(value, reader);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("forbidden");
    expect((thrown as AppError).message).toContain(reason);
  });
});
