import { describe, expect, it } from "vitest";
import { readLive } from "./live-info";
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
