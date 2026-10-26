import { describe, expect, it } from "vitest";
import { readLive } from "./live-info";
import type { RuntimeLifecycle } from "./runtime";
import { isThreadIdle, type RuntimeLiveInfo, readRuntimeLive, waitOutcomeOf } from "./runtime-live";
import type { ConversationView } from "./view";

const viewWithDocs = (docs: Record<string, unknown>) =>
  ({ entries: [], docs }) as unknown as ConversationView;

const idleView = viewWithDocs({});
const busyView = viewWithDocs({ "pi.live": { run: {} } });
const queuedView = viewWithDocs({
  "pi.live": { run: { taskId: "t1" } },
  "pi.inbox": {
    items: [
      { id: 1, mode: "followUp", entry: { kind: "app.retry" }, content: "later" },
      { id: 2, mode: "steer", content: [{ type: "text", text: "now" }] },
    ],
  },
});
const staleIdleView = viewWithDocs({ "pi.live": {}, "pi.inbox": { items: [] } });

const infoWith = (patch: Partial<RuntimeLiveInfo>): RuntimeLiveInfo => ({
  ...readRuntimeLive(idleView, "pi"),
  ...patch,
});

describe("readRuntimeLive for pi", () => {
  it("reports an idle view as settled and done", () => {
    const info = readRuntimeLive(idleView, "pi");
    expect(info.executor).toBe("pi");
    expect(info.lifecycle).toBeUndefined();
    expect(info.writer).toBe("settled");
    expect(isThreadIdle(info)).toBe(true);
    expect(waitOutcomeOf(info)).toBe("done");
  });

  it("reports a busy view as running and pending", () => {
    const info = readRuntimeLive(busyView, "pi");
    expect(info.lifecycle).toBe("running");
    expect(info.writer).toBe("running");
    expect(isThreadIdle(info)).toBe(false);
    expect(waitOutcomeOf(info)).toBe("pending");
  });

  it("passes the legacy live fields through exactly", () => {
    const { executor, lifecycle, writer, ...live } = readRuntimeLive(queuedView, "pi");
    expect(live).toEqual(readLive(queuedView));
    expect(live.queued).toHaveLength(2);
  });

  it("treats an omitted executor as pi", () => {
    expect(readRuntimeLive(idleView, undefined)).toEqual(readRuntimeLive(idleView, "pi"));
    expect(readRuntimeLive(busyView, undefined)).toEqual(readRuntimeLive(busyView, "pi"));
  });
});

describe("readRuntimeLive for claude-code", () => {
  it("never treats an empty view as idle", () => {
    const info = readRuntimeLive(idleView, "claude-code");
    expect(info.executor).toBe("claude-code");
    expect(info).toMatchObject({
      busy: false,
      streaming: undefined,
      retry: undefined,
      slots: [],
      queued: [],
      compacting: false,
      lifecycle: undefined,
      writer: "unknown",
    });
    expect(isThreadIdle(info)).toBe(false);
    expect(waitOutcomeOf(info)).toBe("unknown");
  });

  it("ignores a stale idle pi.live doc", () => {
    const info = readRuntimeLive(staleIdleView, "claude-code");
    expect(info.writer).toBe("unknown");
    expect(isThreadIdle(info)).toBe(false);
    expect(waitOutcomeOf(info)).toBe("unknown");
  });

  it("ignores a busy pi.live doc", () => {
    const info = readRuntimeLive(busyView, "claude-code");
    expect(info.busy).toBe(false);
    expect(info.writer).toBe("unknown");
  });
});

const nativeEntry = (id: number, data: Record<string, unknown>) => ({ id, kind: "native.event", data });

const lifecycleEntry = (id: number, lifecycle: RuntimeLifecycle) =>
  nativeEntry(id, { type: "lifecycle", key: `thread:${lifecycle}:${id}`, lifecycle });

const userEntry = (id: number, requestId: string, text: string) =>
  nativeEntry(id, {
    type: "user",
    key: `${requestId}:user`,
    requestId,
    receiptId: `1:0:${id}`,
    text,
    delivery: "queue",
    attachmentCount: 0,
  });

const queueEntry = (id: number, requestId: string, disposition: string) =>
  nativeEntry(id, { type: "queue", key: `${requestId}:${disposition}`, requestId, disposition });

const nativeView = (...entries: unknown[]) => ({ entries, docs: {} }) as unknown as ConversationView;

describe("readRuntimeLive for claude-code from native events", () => {
  it.each([
    ["accepted", false, "running", "pending"],
    ["preparing", true, "running", "pending"],
    ["ready", true, "running", "pending"],
    ["starting", true, "running", "pending"],
    ["running", true, "running", "pending"],
    ["cancelling", true, "cancelling", "pending"],
    ["reconciling", true, "reconciling", "pending"],
    ["blocked", false, "settled", "pending"],
    ["completed", false, "settled", "done"],
    ["failed", false, "settled", "done"],
    ["cancelled", false, "settled", "done"],
    ["interrupted", false, "settled", "done"],
    ["outcome-unknown", false, "unknown", "unknown"],
  ] as const)("maps the %s lifecycle (busy %s, writer %s, wait %s)", (lifecycle, busy, writer, wait) => {
    const info = readRuntimeLive(nativeView(lifecycleEntry(1, lifecycle)), "claude-code");
    expect(info).toMatchObject({ executor: "claude-code", lifecycle, busy, writer });
    expect(info.streaming).toBeUndefined();
    expect(info.slots).toEqual([]);
    expect(waitOutcomeOf(info)).toBe(wait);
  });

  it("follows the last lifecycle event, not the first", () => {
    const view = nativeView(lifecycleEntry(1, "running"), lifecycleEntry(2, "completed"));
    expect(readRuntimeLive(view, "claude-code")).toMatchObject({ lifecycle: "completed", writer: "settled" });
    expect(isThreadIdle(readRuntimeLive(view, "claude-code"))).toBe(true);
  });

  it("stays unknown for a native view with entries but no lifecycle event", () => {
    const info = readRuntimeLive(nativeView(userEntry(1, "r1", "hi")), "claude-code");
    expect(info).toMatchObject({ lifecycle: undefined, writer: "unknown", busy: false });
    expect(waitOutcomeOf(info)).toBe("unknown");
  });

  it("ignores malformed lifecycle events", () => {
    const view = nativeView(
      lifecycleEntry(1, "running"),
      nativeEntry(2, { type: "lifecycle", key: "x", lifecycle: "dancing" }),
    );
    expect(readRuntimeLive(view, "claude-code").lifecycle).toBe("running");
  });

  it("queues the user events whose latest queue disposition is queued", () => {
    const view = nativeView(
      lifecycleEntry(1, "accepted"),
      userEntry(2, "r1", "first"),
      queueEntry(3, "r1", "queued"),
      userEntry(4, "r2", "second"),
      queueEntry(5, "r2", "queued"),
      userEntry(6, "r3", "third"),
      queueEntry(7, "r3", "queued"),
      queueEntry(8, "r1", "delivered"),
      queueEntry(9, "r3", "cancelled"),
    );
    expect(readRuntimeLive(view, "claude-code").queued).toEqual([
      { id: 2, mode: "followUp", entryKind: "native.user", text: "second", images: [] },
    ]);
  });

  it("does not queue a user event that never got a queued disposition", () => {
    expect(readRuntimeLive(nativeView(userEntry(1, "r1", "hi")), "claude-code").queued).toEqual([]);
  });

  it("ignores native events for a Pi thread", () => {
    const view = nativeView(lifecycleEntry(1, "running"));
    expect(readRuntimeLive(view, "pi")).toEqual(readRuntimeLive(idleView, "pi"));
  });
});

describe("isThreadIdle and waitOutcomeOf", () => {
  it("is idle for a settled writer with a terminal lifecycle", () => {
    const info = infoWith({ writer: "settled", lifecycle: "completed" });
    expect(isThreadIdle(info)).toBe(true);
    expect(waitOutcomeOf(info)).toBe("done");
  });

  it("is not idle for a settled writer with a live lifecycle", () => {
    const info = infoWith({ writer: "settled", lifecycle: "blocked" });
    expect(isThreadIdle(info)).toBe(false);
    expect(waitOutcomeOf(info)).toBe("pending");
  });

  it("is not idle while the writer is cancelling or reconciling", () => {
    expect(isThreadIdle(infoWith({ writer: "cancelling" }))).toBe(false);
    expect(waitOutcomeOf(infoWith({ writer: "reconciling" }))).toBe("pending");
  });

  it("never maps an unknown outcome to done", () => {
    const unknownLifecycle = infoWith({ writer: "settled", lifecycle: "outcome-unknown" });
    expect(waitOutcomeOf(unknownLifecycle)).toBe("unknown");
    expect(waitOutcomeOf(infoWith({ writer: "unknown", lifecycle: "completed" }))).toBe("unknown");
    expect(isThreadIdle(infoWith({ writer: "unknown", lifecycle: undefined }))).toBe(false);
  });
});

describe("legacy readLive", () => {
  it("is unchanged by reading runtime live", () => {
    const before = readLive(queuedView);
    readRuntimeLive(queuedView, "pi");
    readRuntimeLive(queuedView, "claude-code");
    expect(readLive(queuedView)).toEqual(before);
  });
});
