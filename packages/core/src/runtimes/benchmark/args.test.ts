import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_PATH, DEFAULT_OUTPUT_PATH, parseBenchmarkArgs, UsageError } from "./args";

describe("parseBenchmarkArgs", () => {
  it("refuses to run without --offline", () => {
    expect(() => parseBenchmarkArgs([])).toThrow(UsageError);
    expect(() => parseBenchmarkArgs(["--samples", "20"])).toThrow("--offline");
  });

  it("applies the defaults when only --offline is given", () => {
    expect(parseBenchmarkArgs(["--offline"])).toEqual({
      configPath: DEFAULT_CONFIG_PATH,
      outputPath: DEFAULT_OUTPUT_PATH,
      samples: undefined,
      concurrency: undefined,
    });
  });

  it("reads every flag", () => {
    const args = parseBenchmarkArgs([
      "--offline",
      "--config",
      "c.json",
      "--output",
      "o.json",
      "--samples",
      "7",
      "--concurrency",
      "4",
    ]);

    expect(args).toEqual({ configPath: "c.json", outputPath: "o.json", samples: 7, concurrency: 4 });
  });

  it.each([["0"], ["-3"], ["2.5"], ["many"]])("refuses --samples %s", (samples) => {
    expect(() => parseBenchmarkArgs(["--offline", "--samples", samples])).toThrow("--samples");
  });

  it.each([["2"], ["0"], ["four"]])("refuses --concurrency %s", (concurrency) => {
    expect(() => parseBenchmarkArgs(["--offline", "--concurrency", concurrency])).toThrow("--concurrency");
  });

  it("refuses an unknown flag", () => {
    expect(() => parseBenchmarkArgs(["--offline", "--online"])).toThrow();
  });
});
