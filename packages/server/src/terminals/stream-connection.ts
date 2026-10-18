import {
  AppError,
  type Core,
  TERMINAL_STREAM_CLOSE_SLOW,
  TERMINAL_STREAM_CLOSE_UNKNOWN,
  TERMINAL_STREAM_MAX_INPUT_BYTES,
  type TerminalAttachment,
  type TerminalClientFrame,
  TerminalClientFrameSchema,
  type TerminalServerFrame,
} from "@tau/protocol";
import { Value } from "typebox/value";
import type { RawData, WebSocket } from "ws";
import { closeIfOversized } from "../ws-frame-cap";
import { createCoalescer } from "./coalescer";
import { watchStall } from "./stall-watch";

const INTERNAL_ERROR = 1011;
const SLOW_CLOSE_GRACE_MS = 2000;

export function decodeResize(raw: string): TerminalClientFrame | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return Value.Check(TerminalClientFrameSchema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const toBytes = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
};

/** One attached pane: attaches to the core, sends `ready`, coalesced output, then `exit`; detaches on close. */
export class TerminalStream {
  private readonly coalescer = createCoalescer((frame) => this.sendBinary(frame));
  private readonly stopWatching: () => void;
  private readonly attachment: Promise<TerminalAttachment | undefined>;
  private ready = false;
  private exited = false;
  private queue: Array<() => void> = [];

  constructor(
    private readonly socket: WebSocket,
    core: Core,
    id: string,
    private readonly onError: (error: unknown) => void,
  ) {
    this.stopWatching = watchStall(socket, () => this.dropSlowClient());
    this.attachment = this.attach(core, id);
    socket.on("message", (data, isBinary) => void this.handleMessage(data, isBinary));
    socket.on("close", () => void this.dispose());
    socket.on("error", onError);
  }

  /** A stalled client never reads the close frame queued behind its data: close with 1013, then cut the socket so the buffer is freed. */
  private dropSlowClient(): void {
    this.socket.close(TERMINAL_STREAM_CLOSE_SLOW, "too slow");
    const cut = setTimeout(() => this.socket.terminate(), SLOW_CLOSE_GRACE_MS);
    cut.unref();
    this.socket.once("close", () => clearTimeout(cut));
  }

  private async attach(core: Core, id: string): Promise<TerminalAttachment | undefined> {
    try {
      const attachment = await core.terminals.attach(id, {
        onData: (data) => this.afterReady(() => this.coalescer.push(data)),
        onExit: (code) => this.afterReady(() => this.sendExit(code)),
      });
      if (this.socket.readyState !== this.socket.OPEN) {
        attachment.detach();
        return undefined;
      }
      this.sendText({ type: "ready", status: attachment.status, exitCode: attachment.exitCode });
      this.ready = true;
      for (const step of this.queue.splice(0)) step();
      if (attachment.status === "exited") this.finishExited(attachment.exitCode);
      return attachment;
    } catch (error) {
      this.failAttach(error);
      return undefined;
    }
  }

  /** Attaching to an ended terminal never calls `onExit`: send the replay, then `exit`, then close. */
  private finishExited(exitCode: number | null): void {
    this.afterReady(() => {
      this.sendExit(exitCode);
      this.socket.close(1000, "exited");
    });
  }

  private failAttach(error: unknown): void {
    if (error instanceof AppError && error.code === "not_found") {
      this.socket.close(TERMINAL_STREAM_CLOSE_UNKNOWN, "not_found");
      return;
    }
    this.onError(error);
    this.socket.close(INTERNAL_ERROR, "internal_error");
  }

  private afterReady(step: () => void): void {
    if (this.ready) step();
    else this.queue.push(step);
  }

  private sendExit(exitCode: number | null): void {
    if (this.exited) return;
    this.exited = true;
    this.coalescer.flush();
    this.sendText({ type: "exit", exitCode });
  }

  private sendBinary(frame: Uint8Array): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(frame, { binary: true });
  }

  private sendText(frame: TerminalServerFrame): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  private async handleMessage(data: RawData, isBinary: boolean): Promise<void> {
    if (closeIfOversized(this.socket, data, TERMINAL_STREAM_MAX_INPUT_BYTES)) return;
    const attachment = await this.attachment;
    if (!attachment) return;
    if (isBinary) return attachment.write(toBytes(data));
    const frame = decodeResize(data.toString());
    if (!frame) return this.socket.close(TERMINAL_STREAM_CLOSE_UNKNOWN, "invalid frame");
    attachment.resize(frame.cols, frame.rows);
  }

  private async dispose(): Promise<void> {
    this.stopWatching();
    this.coalescer.dispose();
    this.queue = [];
    (await this.attachment)?.detach();
  }
}
