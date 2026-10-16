import type { Change, ClientFrame, ConversationView, Op, ServerFrame } from "@pi-everywhere/protocol";
import type { LiveHandlers, LiveSocket, LiveTransport } from "@/lib/api";
import { nextViewState, type ViewState } from "./apply-view-ops";
import type { LiveClient, LiveStatus } from "./live-client";
import { reconnectDelayMs } from "./reconnect-delay";

type ViewListener = (view: ConversationView | null) => void;

interface Subscription {
  view: ViewState;
  readonly listeners: Set<ViewListener>;
}

function addListener<T>(set: Set<T>, listener: T): () => void {
  set.add(listener);
  return () => set.delete(listener);
}

function notify<T>(listeners: Iterable<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      console.error("live listener failed", error);
    }
  }
}

/** One WebSocket for the app: reference-counted subscriptions, a view per conversation, reconnect with backoff. */
export function createLiveClient(transport: LiveTransport): LiveClient {
  const subscriptions = new Map<string, Subscription>();
  const changedListeners = new Set<(change: Change) => void>();
  const statusListeners = new Set<(status: LiveStatus) => void>();
  let status: LiveStatus = "closed";
  let socket: LiveSocket | undefined;
  let failedAttempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const setStatus = (next: LiveStatus) => {
    if (next === status) return;
    status = next;
    notify(statusListeners, next);
  };

  const sendIfOpen = (frame: ClientFrame) => {
    if (status === "open") socket?.send(frame);
  };

  const resync = (conversationId: string) => {
    sendIfOpen({ type: "unsubscribe", conversationId });
    sendIfOpen({ type: "subscribe", conversationId });
  };

  const applyOps = (conversationId: string, ops: readonly Op[]) => {
    const subscription = subscriptions.get(conversationId);
    if (!subscription) return;
    try {
      const next = nextViewState(subscription.view, ops);
      if (next === subscription.view) return;
      subscription.view = next;
      if (next !== undefined) notify(subscription.listeners, next);
    } catch (error) {
      console.error("bad ops for conversation, resubscribing", error);
      resync(conversationId);
    }
  };

  const handleFrame = (frame: ServerFrame) => {
    if (frame.type === "ops") applyOps(frame.conversationId, frame.ops);
    else notify(changedListeners, frame);
  };

  const scheduleReconnect = () => {
    setStatus("reconnecting");
    retryTimer = setTimeout(connect, reconnectDelayMs(failedAttempts));
    failedAttempts += 1;
  };

  const handlers: LiveHandlers = {
    onOpen() {
      failedAttempts = 0;
      setStatus("open");
      for (const conversationId of subscriptions.keys()) socket?.send({ type: "subscribe", conversationId });
    },
    onFrame: handleFrame,
    onClose() {
      socket = undefined;
      if (!closed) scheduleReconnect();
    },
  };

  function connect() {
    retryTimer = undefined;
    if (closed) return;
    if (status !== "reconnecting") setStatus("connecting");
    socket = transport.open(handlers);
  }

  const ensureConnected = () => {
    if (closed || socket || retryTimer) return;
    connect();
  };

  return {
    subscribe(conversationId, onView) {
      let subscription = subscriptions.get(conversationId);
      if (!subscription) {
        subscription = { view: undefined, listeners: new Set() };
        subscriptions.set(conversationId, subscription);
        sendIfOpen({ type: "subscribe", conversationId });
      }
      subscription.listeners.add(onView);
      if (subscription.view !== undefined) onView(subscription.view);
      ensureConnected();
      return () => {
        const current = subscriptions.get(conversationId);
        if (!current?.listeners.delete(onView) || current.listeners.size > 0) return;
        subscriptions.delete(conversationId);
        sendIfOpen({ type: "unsubscribe", conversationId });
      };
    },
    onChanged(listener) {
      const remove = addListener(changedListeners, listener);
      ensureConnected();
      return remove;
    },
    get status() {
      return status;
    },
    onStatus: (listener) => addListener(statusListeners, listener),
    close() {
      closed = true;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      socket?.close();
      socket = undefined;
      subscriptions.clear();
      changedListeners.clear();
      setStatus("closed");
      statusListeners.clear();
    },
  };
}
