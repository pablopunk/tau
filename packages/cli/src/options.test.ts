import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, parseCliOptions } from "./options";

describe("parseCliOptions", () => {
  it("has sensible defaults", () => {
    expect(parseCliOptions([], {})).toEqual({
      port: DEFAULT_PORT,
      open: true,
      home: join(homedir(), ".tau"),
      faux: false,
    });
  });

  it("reads flags", () => {
    expect(parseCliOptions(["--port", "9000", "--no-open", "--home", "/h", "--faux"], {})).toEqual({
      port: 9000,
      open: false,
      home: "/h",
      faux: true,
    });
  });

  it("reads TAU_HOME and TAU_FAUX, with flags winning for home", () => {
    const env = { TAU_HOME: "/env", TAU_FAUX: "1" };
    expect(parseCliOptions([], env)).toMatchObject({ home: "/env", faux: true });
    expect(parseCliOptions(["--home", "/flag"], env).home).toBe("/flag");
  });

  it("rejects an invalid port", () => {
    expect(() => parseCliOptions(["--port", "abc"], {})).toThrow("Invalid --port");
    expect(() => parseCliOptions(["--port", "70000"], {})).toThrow("Invalid --port");
  });
});
