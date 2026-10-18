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
} from "@tau/protocol";
import type { WebSocket } from "ws";
import { closeIfOversized } from "../ws-frame-cap";
import { waitForDrain } from "./backpressure";

interface Subscription {
  cancelled: boolean;
  watcher: Promise<ConversationWatcher | undefined>;
}

const POLICY_VIOLATION = 1008;

/** One browser tab: its conversation subscriptions plus the shared `changed` broadcasts. */
export class LiveConnection {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly stopListeningForChanges: () => void;

  constructor(
    private readonly socket: WebSocket,
    private readonly core: Core,
    private readonly onError: (error: unknown) => void,
  ) {
    this.stopListeningForChanges = core.onChange((change) => this.sendChange(change));
    socket.on("message", (data) => {
      if (closeIfOversized(socket, data, LIVE_MAX_FRAME_BYTES)) return;
      this.handleMessage(data.toString());
    });
    socket.on("close", () => void this.dispose());
    socket.on("error", onError);
  }

  private sendChange(change: Change): void {
    this.send(changedFrame(change));
  }

  private sendOps(conversationId: string, ops: readonly Op[]): void {
    this.send({ type: "ops", conversationId, ops });
  }

  private send(frame: ServerFrame): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(encodeFrame(frame));
  }

  private handleMessage(raw: string): void {
    const frame = decodeClientFrame(raw);
    if (!frame) return void this.socket.close(POLICY_VIOLATION, "invalid frame");
    if (frame.type === "subscribe") this.subscribe(frame.conversationId);
    else void this.unsubscribe(frame.conversationId).catch(this.onError);
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
      if (!isAppError(error)) this.onError(error);
      else if (!subscription.cancelled) this.sendOps(conversationId, RETIRED_OPS);
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
    this.stopListeningForChanges();
    await Promise.all([...this.subscriptions.keys()].map((id) => this.unsubscribe(id).catch(this.onError)));
  }
}
