import {
  TERMINAL_STREAM_MAX_INPUT_BYTES,
  TerminalClientFrameSchema,
  type TerminalServerFrame,
  TerminalServerFrameSchema,
} from "@tau/protocol";
import { Value } from "typebox/value";
import { usageError } from "./cli-exit";

export function terminalInputFrame(line: string): string | Uint8Array {
  if (Buffer.byteLength(line) > TERMINAL_STREAM_MAX_INPUT_BYTES * 2)
    throw usageError("Terminal input exceeds byte cap");
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw usageError("Terminal stdin must be NDJSON");
  }
  if (Value.Check(TerminalClientFrameSchema, value)) return JSON.stringify(value);
  const frame = value as { type?: unknown; encoding?: unknown; data?: unknown } | null;
  if (
    frame?.type !== "input" ||
    frame.encoding !== "base64" ||
    typeof frame.data !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)
  ) {
    throw usageError("Expected base64 input or a valid terminal resize frame");
  }
  const bytes = Buffer.from(frame.data, "base64");
  if (bytes.length > TERMINAL_STREAM_MAX_INPUT_BYTES) throw usageError("Terminal input exceeds byte cap");
  return bytes;
}

export async function terminalServerFrame(
  data: unknown,
): Promise<TerminalServerFrame | { type: "output"; encoding: "base64"; data: string }> {
  if (typeof data === "string") {
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      throw usageError("Invalid terminal control frame");
    }
    if (!Value.Check(TerminalServerFrameSchema, frame)) throw usageError("Invalid terminal control frame");
    return frame;
  }
  const bytes =
    data instanceof Blob
      ? new Uint8Array(await data.arrayBuffer())
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : null;
  if (!bytes) throw usageError("Invalid terminal output frame");
  return { type: "output", encoding: "base64", data: Buffer.from(bytes).toString("base64") };
}
