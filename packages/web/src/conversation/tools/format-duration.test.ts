import { describe, expect, it } from "vitest";
import { formatDurationMs } from "./format-duration";

describe("formatDurationMs", () => {
  it("shows milliseconds under a second", () => {
    expect(formatDurationMs(0)).toBe("0ms");
    expect(formatDurationMs(25)).toBe("25ms");
    expect(formatDurationMs(999)).toBe("999ms");
  });

  it("shows one decimal under ten seconds", () => {
    expect(formatDurationMs(1000)).toBe("1.0s");
    expect(formatDurationMs(1250)).toBe("1.3s");
    expect(formatDurationMs(9876)).toBe("9.9s");
  });

  it("shows whole seconds under a minute", () => {
    expect(formatDurationMs(12_000)).toBe("12s");
    expect(formatDurationMs(59_400)).toBe("59s");
  });

  it("shows minutes and seconds under an hour", () => {
    expect(formatDurationMs(65_000)).toBe("1m 5s");
    expect(formatDurationMs(120_000)).toBe("2m");
  });

  it("shows hours and minutes", () => {
    expect(formatDurationMs(3_600_000)).toBe("1h");
    expect(formatDurationMs(3_723_000)).toBe("1h 2m");
  });
});
