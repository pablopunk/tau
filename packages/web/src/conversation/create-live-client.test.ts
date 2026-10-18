import type { ClientFrame, ConversationView, ServerFrame } from "@tau/protocol";
import { finalView, fixtures } from "@tau/testkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveHandlers, LiveTransport } from "@/lib/api";
import { createLiveClient } from "./create-live-client";

interface FakeSocket {
  readonly sent: ClientFrame[];
  readonly handlers: LiveHandlers;
  closed: boolean;
}

function createFakeTransport() {
  const sockets: FakeSocket[] = [];
  const transport: LiveTransport = {
    open(handlers) {
      const socket: FakeSocket = { sent: [], handlers, closed: false };
      sockets.push(socket);
      return {
        send: (frame) => socket.sent.push(frame),
        close: () => {
          socket.closed = true;
        },
      };
    },
  };
  return { transport, sockets, last: () => sockets[sockets.length - 1] as FakeSocket };
}

const emptyView = (id: number): ConversationView =>
  ({
    conversation: { id },
    entries: [],
    docs: {},
  }) as unknown as ConversationView;

const opsFrame = (conversationId: string, ops: unknown): ServerFrame => ({
  type: "ops",
  conversationId,
  ops: ops as never,
});

describe("createLiveClient", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("connects on first use and subscribes once per conversation", () => {
    const { transport, last, sockets } = createFakeTransport();
    const client = createLiveClient(transport);
    expect(sockets).toHaveLength(0);
    const first = client.subscribe("c1", () => {});
    const second = client.subscribe("c1", () => {});
    last().handlers.onOpen();
    expect(client.status).toBe("open");
    expect(last().sent).toEqual([{ type: "subscribe", conversationId: "c1" }]);
    first();
    expect(last().sent).toHaveLength(1);
    second();
    expect(last().sent[1]).toEqual({ type: "unsubscribe", conversationId: "c1" });
  });

  it("sends subscribe immediately when the socket is already open", () => {
    const { transport, last } = createFakeTransport();
    const client = createLiveClient(transport);
    client.onChanged(() => {});
    last().handlers.onOpen();
    client.subscribe("c2", () => {});
    expect(last().sent).toEqual([{ type: "subscribe", conversationId: "c2" }]);
  });

  it("applies a base frame then deltas and gives late subscribers the current view", () => {
    const { transport, last } = createFakeTransport();
    const client = createLiveClient(transport);
    const views: (ConversationView | null)[] = [];
    client.subscribe("c1", (view) => views.push(view));
    last().handlers.onOpen();
    last().handlers.onFrame(opsFrame("c1", [["r", emptyView(1)]]));
    last().handlers.onFrame(opsFrame("c1", [["s", ["docs", "pi.live"], { run: { taskId: 1, inputs: [] } }]]));
    expect(views).toHaveLength(2);
    expect(views[1]?.docs["pi.live"]).toEqual({ run: { taskId: 1, inputs: [] } });
    const late = vi.fn();
    client.subscribe("c1", late);
    expect(late).toHaveBeenCalledWith(views[1]);
  });

  it("replays a recorded fixture to its final view, including a mid-stream reset", () => {
    const { transport, last } = createFakeTransport();
    const client = createLiveClient(transport);
    let latest: ConversationView | null | undefined;
    const fixture = fixtures.overflow;
    client.subscribe(fixture.conversationId, (view) => {
      latest = view;
    });
    last().handlers.onOpen();
    for (const frame of fixture.frames) {
      last().handlers.onFrame(opsFrame(fixture.conversationId, frame.ops));
    }
    expect(latest).toEqual(finalView(fixture));
  });

  it("delivers null for a retired view and ignores deltas after it", () => {
    const { transport, last } = createFakeTransport();
    const client = createLiveClient(transport);
    const views: (ConversationView | null)[] = [];
    client.subscribe("c1", (view) => views.push(view));
    last().handlers.onOpen();
    last().handlers.onFrame(opsFrame("c1", [["r", emptyView(1)]]));
    last().handlers.onFrame(opsFrame("c1", [["r", null]]));
    last().handlers.onFrame(opsFrame("c1", [["s", ["docs", "x"], 1]]));
    expect(views.map((view) => view === null)).toEqual([false, true]);
  });

  it("resubscribes when an op cannot be applied", () => {
    const { transport, last } = createFakeTransport();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createLiveClient(transport);
    client.subscribe("c1", () => {});
    last().handlers.onOpen();
    last().handlers.onFrame(opsFrame("c1", [["r", emptyView(1)]]));
    last().handlers.onFrame(opsFrame("c1", [["s", ["entries", 99, "x", "y"], 1]]));
    expect(last().sent.slice(-2)).toEqual([
      { type: "unsubscribe", conversationId: "c1" },
      { type: "subscribe", conversationId: "c1" },
    ]);
  });

  it("forwards changed frames to onChanged listeners until unsubscribed", () => {
    const { transport, last } = createFakeTransport();
    const client = createLiveClient(transport);
    const listener = vi.fn();
    const stop = client.onChanged(listener);
    last().handlers.onOpen();
    last().handlers.onFrame({ type: "changed", resource: "projects" });
    stop();
    last().handlers.onFrame({ type: "changed", resource: "projects" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reconnects with backoff, resubscribes and replaces the view with the fresh base", () => {
    const { transport, sockets, last } = createFakeTransport();
    const client = createLiveClient(transport);
    const statuses: string[] = [];
    client.onStatus((status) => statuses.push(status));
    const views: (ConversationView | null)[] = [];
    client.subscribe("c1", (view) => views.push(view));
    last().handlers.onOpen();
    last().handlers.onFrame(opsFrame("c1", [["r", emptyView(1)]]));

    last().handlers.onClose();
    expect(client.status).toBe("reconnecting");
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    last().handlers.onClose();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    last().handlers.onOpen();
    expect(last().sent).toEqual([{ type: "subscribe", conversationId: "c1" }]);
    last().handlers.onFrame(opsFrame("c1", [["r", emptyView(7)]]));
    expect(views.at(-1)?.conversation.id).toBe(7);
    expect(statuses).toEqual(["connecting", "open", "reconnecting", "open"]);
  });

  it("restarts the backoff after a successful connection", () => {
    const { transport, sockets, last } = createFakeTransport();
    const client = createLiveClient(transport);
    client.onChanged(() => {});
    last().handlers.onClose();
    vi.advanceTimersByTime(500);
    last().handlers.onClose();
    vi.advanceTimersByTime(1000);
    last().handlers.onOpen();
    last().handlers.onClose();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(4);
  });

  it("stops everything on close", () => {
    const { transport, sockets, last } = createFakeTransport();
    const client = createLiveClient(transport);
    client.onChanged(() => {});
    last().handlers.onClose();
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.status).toBe("closed");
    const open = createFakeTransport();
    const second = createLiveClient(open.transport);
    second.onChanged(() => {});
    second.close();
    expect(open.last().closed).toBe(true);
  });
});
