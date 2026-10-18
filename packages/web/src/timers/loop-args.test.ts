import { describe, expect, it } from "vitest";
import { parseLoopArgs } from "./loop-args";

describe("parseLoopArgs", () => {
  it("reads an interval and the prompt", () => {
    expect(parseLoopArgs("5m check the build")).toEqual({
      action: "start",
      input: { every: "5m", prompt: "check the build" },
    });
    expect(parseLoopArgs("  2h  keep going ")).toEqual({
      action: "start",
      input: { every: "2h", prompt: "keep going" },
    });
    expect(parseLoopArgs("1d daily")).toMatchObject({ input: { every: "1d" } });
  });

  it("without an interval the agent paces itself", () => {
    expect(parseLoopArgs("check the build")).toEqual({
      action: "start",
      input: { prompt: "check the build" },
    });
    expect(parseLoopArgs("30s is not an interval")).toEqual({
      action: "start",
      input: { prompt: "30s is not an interval" },
    });
  });

  it("stops the loop", () => {
    expect(parseLoopArgs("stop")).toEqual({ action: "stop" });
    expect(parseLoopArgs(" STOP ")).toEqual({ action: "stop" });
  });

  it("shows the usage for no prompt", () => {
    expect(parseLoopArgs("")).toEqual({ action: "usage" });
    expect(parseLoopArgs("5m")).toEqual({ action: "usage" });
  });
});
