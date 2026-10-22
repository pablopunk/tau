import type { Change, ClientFrame, ConversationView, Op, ServerFrame } from "@tau/protocol";
import { nextViewState, type ViewState } from "@tau/protocol";
import type { LiveHandlers, LiveSocket, LiveTransport } from "@/lib/api";
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

  const safeSend = (target: LiveSocket | undefined, frame: ClientFrame): boolean => {
    if (status !== "open" || !target) return false;
    try {
      target.send(frame);
      return true;
    } catch (error) {
      console.error("live send failed, reconnecting", error);
      // The socket looks open but refuses sends (closing race): drop it so
      // the reconnect path resubscribes and delivers a fresh base view.
      // Closing alone may never fire onClose on a dead socket, so schedule
      // the retry explicitly when this was the current socket.
      try {
        target.close();
      } catch {
        // ignore: already closing
      }
      if (socket === target) {
        socket = undefined;
        scheduleReconnect();
      }
      return false;
    }
  };

  const sendIfOpen = (frame: ClientFrame) => {
    safeSend(socket, frame);
  };

  const resync = (conversationId: string) => {
    // Unsubscribe and subscribe are back-to-back on the same socket: either
    // both go out or, when the socket is gone, the reconnect resubscribe
    // covers every subscription. Never let a half-sent resync strand the view.
    const target = socket;
    if (!safeSend(target, { type: "unsubscribe", conversationId })) return;
    if (!safeSend(target, { type: "subscribe", conversationId }) && target) {
      try {
        target.close();
      } catch {
        // ignore: already closing
      }
    }
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
    else if (frame.type === "changed") notify(changedListeners, frame);
  };

  const scheduleReconnect = () => {
    if (closed) return;
    // Never stack timers: each close replaces the pending retry, so at most
    // one socket is ever dialing and duplicate deliveries can't interleave.
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    setStatus("reconnecting");
    retryTimer = setTimeout(connect, reconnectDelayMs(failedAttempts));
    failedAttempts += 1;
  };

  function connect() {
    retryTimer = undefined;
    if (closed) return;
    if (status !== "reconnecting") setStatus("connecting");
    // One socket at a time: a leaked predecessor would keep delivering ops
    // for the same views, and every duplicate batch would look like a bad op.
    try {
      socket?.close();
    } catch {
      // ignore: already closing
    }
    socket = undefined;
    // Handlers are per-connection and only touch the current socket: a late
    // event from a dead predecessor must not wipe or pollute its replacement.
    // In particular, ops frames carry per-view deltas, so a superseded socket
    // must never apply them to the shared views; change broadcasts stay
    // shared because they are idempotent invalidations.
    const handlers: LiveHandlers = {
      onOpen() {
        if (socket !== current) return;
        failedAttempts = 0;
        setStatus("open");
        for (const conversationId of subscriptions.keys())
          safeSend(current, { type: "subscribe", conversationId });
      },
      onFrame(frame) {
        if (frame.type === "ops" && socket !== current) return;
        handleFrame(frame);
      },
      onClose() {
        if (socket !== current) return;
        socket = undefined;
        if (!closed) scheduleReconnect();
      },
    };
    let current: LiveSocket;
    try {
      current = transport.open(handlers);
    } catch (error) {
      console.error("live open failed, reconnecting", error);
      scheduleReconnect();
      return;
    }
    socket = current;
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
