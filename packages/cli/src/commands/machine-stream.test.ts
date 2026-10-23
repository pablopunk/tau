import { TERMINAL_STREAM_MAX_INPUT_BYTES } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { terminalInputFrame, terminalServerFrame } from "./machine-stream";

describe("terminal NDJSON byte framing", () => {
  it("round-trips arbitrary non-UTF8 bytes exactly", async () => {
    const bytes = Buffer.from([0, 255, 128, 27, 10]);
    const frame = await terminalServerFrame(bytes);
    expect(frame).toEqual({ type: "output", encoding: "base64", data: bytes.toString("base64") });
    expect(terminalInputFrame(JSON.stringify({ ...frame, type: "input" }))).toEqual(bytes);
  });
  it("validates shared resize limits", () => {
    expect(terminalInputFrame('{"type":"resize","cols":80,"rows":24}')).toBe(
      '{"type":"resize","cols":80,"rows":24}',
    );
    expect(() => terminalInputFrame('{"type":"resize","cols":501,"rows":24}')).toThrow();
    expect(() => terminalInputFrame('{"type":"resize","cols":0,"rows":24}')).toThrow();
  });
  it("enforces the existing decoded input cap and rejects malformed base64", () => {
    expect(() =>
      terminalInputFrame(
        JSON.stringify({
          type: "input",
          encoding: "base64",
          data: Buffer.alloc(TERMINAL_STREAM_MAX_INPUT_BYTES + 1).toString("base64"),
        }),
      ),
    ).toThrow("byte cap");
    expect(() => terminalInputFrame('{"type":"input","encoding":"base64","data":"!?"}')).toThrow();
    expect(() => terminalInputFrame("raw")).toThrow("NDJSON");
  });
  it("retains typed ready and exit frames", async () => {
    expect(await terminalServerFrame('{"type":"ready","status":"running","exitCode":null}')).toEqual({
      type: "ready",
      status: "running",
      exitCode: null,
    });
    expect(await terminalServerFrame('{"type":"exit","exitCode":0}')).toEqual({ type: "exit", exitCode: 0 });
    await expect(terminalServerFrame("bad")).rejects.toThrow();
  });
});
