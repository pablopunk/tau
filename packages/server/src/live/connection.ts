import {
  type Change,
  type ConversationWatcher,
  type Core,
  changedFrame,
  decodeClientFrame,
  encodeFrame,
  isAppError,
  LIVE_MAX_FRAME_BYTES,
  type Op,
  RETIRED_OPS,
  type ServerFrame,
  watchFailedFrame,
} from "@tau/protocol";
import type { WebSocket } from "ws";
import { logStage, STAGE } from "../timing";
import { closeIfOversized } from "../ws-frame-cap";
import { waitForDrain } from "./backpressure";

interface Subscription {
  cancelled: boolean;
  watcher: Promise<ConversationWatcher | undefined>;
}

/**
 * R4 wire extras, all in the frozen protocol (protocol/src/live.ts):
 * - heartbeat uses the WebSocket protocol ping/pong (no app frame at all);
 * - every `ops` frame carries a per-conversation `seq` (optional so old
 *   decoders still validate; the client gap→resync half lives in
 *   `web/.../create-live-client.ts`);
 * - watcher failure is terminal and visible: RETIRED_OPS for unknown
 *   conversations, the distinct watch-failure frame otherwise.
 */

export interface LiveConnectionOptions {
  /** Defaults to 30s (R4.1). Injectable for tests. */
  heartbeatIntervalMs?: number;
  /** Missed pongs before the socket is terminated. Defaults to 2. */
  heartbeatMissLimit?: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_MISS_LIMIT = 2;

const POLICY_VIOLATION = 1008;

/** One browser tab: its conversation subscriptions plus the shared `changed` broadcasts. */
export class LiveConnection {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly stopListeningForChanges: () => void;
  /** Next sequence number per subscribed conversation. */
  private readonly seq = new Map<string, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatMisses = 0;

  constructor(
    private readonly socket: WebSocket,
    private readonly core: Core,
    private readonly onError: (error: unknown) => void,
    options: LiveConnectionOptions = {},
  ) {
    const intervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    const missLimit = options.heartbeatMissLimit ?? HEARTBEAT_MISS_LIMIT;
    this.stopListeningForChanges = core.onChange((change) => this.sendChange(change));
    socket.on("message", (data) => {
      if (closeIfOversized(socket, data, LIVE_MAX_FRAME_BYTES)) return;
      this.handleMessage(data.toString());
    });
    socket.on("pong", () => {
      this.heartbeatMisses = 0;
    });
    socket.on("close", () => void this.dispose());
    socket.on("error", onError);
    // R4.1 heartbeat: ws-level ping; a half-open TCP socket never pongs, so
    // missed pongs terminate it instead of leaving a stale view that looks alive.
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatMisses >= missLimit) {
        logStage({ action: "live", stage: STAGE.heartbeatTimeout });
        try {
          socket.terminate();
        } finally {
          void this.dispose();
        }
        return;
      }
      this.heartbeatMisses += 1;
      if (socket.readyState === socket.OPEN) socket.ping();
    }, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  private sendChange(change: Change): void {
    this.send(changedFrame(change));
  }

  private sendOps(conversationId: string, ops: readonly Op[]): void {
    const seq = this.seq.get(conversationId) ?? 0;
    this.seq.set(conversationId, seq + 1);
    this.send({ type: "ops", conversationId, ops, seq } as ServerFrame);
  }

  private send(frame: ServerFrame): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(encodeFrame(frame));
  }

  private handleMessage(raw: string): void {
    const frame = decodeClientFrame(raw);
    if (!frame) return void this.socket.close(POLICY_VIOLATION, "invalid frame");
    if (frame.type === "subscribe") this.subscribe(frame.conversationId);
    else if (frame.type === "unsubscribe") void this.unsubscribe(frame.conversationId).catch(this.onError);
  }

  private subscribe(conversationId: string): void {
    if (this.subscriptions.has(conversationId)) return;
    const subscription: Subscription = { cancelled: false, watcher: Promise.resolve(undefined) };
    subscription.watcher = this.startWatching(conversationId, subscription);
    this.subscriptions.set(conversationId, subscription);
  }

  private async startWatching(
    conversationId: string,
    subscription: Subscription,
  ): Promise<ConversationWatcher | undefined> {
    const forward = async (ops: readonly Op[]) => {
      if (subscription.cancelled) return;
      await waitForDrain(this.socket);
      if (!subscription.cancelled) this.sendOps(conversationId, ops);
    };
    try {
      const watcher = await this.core.conversations.watch(conversationId, forward);
      if (!subscription.cancelled) return watcher;
      await watcher.stop();
    } catch (error) {
      // R4.2: a failed subscribe must never leave a mapped entry — otherwise
      // every later subscribe on this socket is a silent no-op and even a
      // client resync cannot recover. The failure is terminal and visible:
      // the client gets a retired view (fresh base on resubscribe), never
      // silence, for AppError and internal errors alike.
      if (this.subscriptions.get(conversationId) === subscription) {
        this.subscriptions.delete(conversationId);
      }
      logStage({ action: "live", stage: STAGE.watchFailure, conversationId });
      if (!subscription.cancelled) {
        // Unknown conversation: the retired view is the truth (it is gone).
        // Anything else: a distinct failure frame so the client resubscribes
        // for a fresh base instead of showing the thread as deleted.
        if (isAppError(error) && error.code === "not_found") this.sendOps(conversationId, RETIRED_OPS);
        else this.send(watchFailedFrame(conversationId));
      }
      if (!isAppError(error)) this.onError(error);
    }
    return undefined;
  }

  private async unsubscribe(conversationId: string): Promise<void> {
    const subscription = this.subscriptions.get(conversationId);
    if (!subscription) return;
    this.subscriptions.delete(conversationId);
    subscription.cancelled = true;
    await (await subscription.watcher)?.stop();
  }

  private async dispose(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.stopListeningForChanges();
    await Promise.all([...this.subscriptions.keys()].map((id) => this.unsubscribe(id).catch(this.onError)));
  }
}
