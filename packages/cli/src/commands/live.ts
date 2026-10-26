import { decodeServerFrame, encodeFrame, LIVE_PATH, nextViewState, type ViewState } from "@tau/protocol";
import type { Server } from "./client";
import type { CommandEnv, SocketLike } from "./command-env";
import { createNativeLineCursor, type NativeLineCursor } from "./native-text";
import { targetPath } from "./node-target";

export interface LiveClient {
  subscribe(conversationId: string): void;
  /** `undefined` before the first frame, `null` for a retired or unknown thread. */
  view(conversationId: string): ViewState;
  /** Called after every frame (ops or changed). */
  onFrame(listener: () => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

const websocketUrlOf = (server: Server): string =>
  `${server.url.replace(/^http/, "ws")}${targetPath(server, LIVE_PATH)}`;

class NodeLiveClient implements LiveClient {
  private readonly socket: SocketLike;
  private readonly views = new Map<string, ViewState>();
  private readonly frameListeners: (() => void)[] = [];
  private readonly closeListeners: (() => void)[] = [];
  private readonly pending: string[] = [];
  private open = false;

  constructor(server: Server, env: CommandEnv) {
    this.socket = env.openSocket(websocketUrlOf(server), { authorization: `Bearer ${server.token}` });
    this.socket.onopen = () => {
      this.open = true;
      for (const frame of this.pending.splice(0)) this.socket.send(frame);
    };
    this.socket.onmessage = (event) => this.receive(String(event.data));
    this.socket.onclose = () => {
      for (const listener of this.closeListeners) listener();
    };
    this.socket.onerror = () => undefined;
  }

  private receive(raw: string): void {
    const frame = decodeServerFrame(raw);
    if (!frame) return;
    if (frame.type === "ops") {
      try {
        this.views.set(frame.conversationId, nextViewState(this.views.get(frame.conversationId), frame.ops));
      } catch {
        return;
      }
    }
    for (const listener of this.frameListeners) listener();
  }

  subscribe(conversationId: string): void {
    const frame = encodeFrame({ type: "subscribe", conversationId });
    if (this.open) this.socket.send(frame);
    else this.pending.push(frame);
  }

  view(conversationId: string): ViewState {
    return this.views.get(conversationId);
  }

  onFrame(listener: () => void): void {
    this.frameListeners.push(listener);
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  close(): void {
    this.socket.close();
  }
}

/** A Node WebSocket client for `subscribe`, `ops` and `changed` frames, with Bearer auth on upgrade. */
export const connectLive = (server: Server, env: CommandEnv): LiveClient => new NodeLiveClient(server, env);

/** Emits each native entry's lines once. Pass the same cursor to a reconnected client to repeat nothing. */
export function followNativeLines(
  live: LiveClient,
  conversationId: string,
  emit: (line: string) => void,
  cursor: NativeLineCursor = createNativeLineCursor(),
): void {
  live.onFrame(() => {
    const view = live.view(conversationId);
    if (!view) return;
    for (const line of cursor.take(view)) emit(line);
  });
}
