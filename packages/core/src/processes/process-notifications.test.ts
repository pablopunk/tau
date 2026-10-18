import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Notification } from "../harness/notification-submitter";
import { createLineSplitter } from "./line-splitter";
import { createMonitorBatcher } from "./monitor-batcher";
import { sleep } from "./process-group";
import { createProcessService, type ProcessService } from "./process-service";

let home: string;
let cwd: string;
let sent: { conversationId: string; notification: Notification }[];
let service: ProcessService;

type Sink = typeof sent;

const makeService = (batchMs = 30, sink: Sink = sent) =>
  createProcessService({
    home,
    batchMs,
    emitChange: () => undefined,
    stopGraceMs: 300,
    notifications: {
      notify: async (conversationId, notification) => void sink.push({ conversationId, notification }),
    },
  });

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await sleep(50);
  }
  throw new Error("timed out");
}

const kinds = () => sent.map((item) => item.notification.kind);
const dataOf = (index: number) => sent[index]?.notification.data as Record<string, unknown>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-mon-home-"));
  cwd = await mkdtemp(join(tmpdir(), "pi-mon-cwd-"));
  sent = [];
  service = makeService();
});

afterEach(async () => {
  await service.stopAll();
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("line splitter", () => {
  it("holds a partial line across chunks and flushes it at the end", () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push("one\ntw");
    splitter.push("o\r\nthr");
    expect(lines).toEqual(["one", "two"]);
    splitter.flush();
    expect(lines).toEqual(["one", "two", "thr"]);
  });
});

describe("monitor batcher", () => {
  it("caps a batch at 20 lines and counts the rest as dropped", async () => {
    const batches: { lines: string[]; dropped: number }[] = [];
    const batcher = createMonitorBatcher({
      send: (batch) => batches.push(batch),
      onNoisy: () => undefined,
      batchMs: 10,
    });
    for (let index = 0; index < 25; index++) batcher.push(`l${index}`);
    await sleep(40);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.lines).toHaveLength(20);
    expect(batches[0]?.dropped).toBe(5);
  });

  it("stops after more than 30 batches in a window", () => {
    let noisy = 0;
    let sentCount = 0;
    const batcher = createMonitorBatcher({
      send: () => sentCount++,
      onNoisy: () => noisy++,
    });
    for (let index = 0; index < 32; index++) {
      batcher.push("x");
      batcher.flush();
    }
    expect(sentCount).toBe(30);
    expect(noisy).toBe(1);
  });
});

describe("monitor service", () => {
  it("sends stdout lines only, then an end event with the exit code", async () => {
    const info = await service.start({
      conversationId: "c1",
      cwd,
      command: "echo out1; echo err1 >&2; echo out2; exit 4",
      kind: "monitor",
      name: "watch",
    });
    await waitFor(() => kinds().length >= 2);
    const events = sent.map((item) => item.notification.data as { lines: string[]; ended?: unknown });
    expect(events.flatMap((event) => event.lines).sort()).toEqual(["out1", "out2"]);
    expect(events.at(-1)?.ended).toEqual({ exitCode: 4 });
    expect(sent[0]?.notification.text.startsWith("<monitor-event")).toBe(true);
    expect(new Set(sent.map((item) => item.notification.requestId)).size).toBe(sent.length);
    expect(info.kind).toBe("monitor");
  });

  it("sends a timeout end event", async () => {
    await service.start({ conversationId: "c1", cwd, command: "sleep 30", kind: "monitor", timeoutMs: 100 });
    await waitFor(() => kinds().length === 1);
    expect(dataOf(0)).toMatchObject({ lines: [], ended: "timeout" });
  });

  it("sends nothing more after a stop request", async () => {
    const info = await service.start({ conversationId: "c1", cwd, command: "sleep 30", kind: "monitor" });
    await service.stop(info.id);
    await sleep(100);
    expect(sent).toEqual([]);
  });

  it("stops a noisy monitor with a notice", async () => {
    const noisy = makeService(1);
    const info = await noisy.start({
      conversationId: "c1",
      cwd,
      command: "i=0; while [ $i -lt 400 ]; do echo $i; i=$((i+1)); sleep 0.02; done",
      kind: "monitor",
      name: "noisy",
    });
    await waitFor(() => kinds().includes("app.notice"));
    await waitFor(() => noisy.hasRunning("c1") === false);
    expect(sent.at(-1)?.notification.text).toContain("too noisy");
    expect(kinds().filter((kind) => kind === "app.notice")).toHaveLength(1);
    expect(info.kind).toBe("monitor");
  });

  it("sends one restart notice per monitor and nothing for other reaped processes", async () => {
    await service.start({ conversationId: "c1", cwd, command: "sleep 60", kind: "monitor", name: "m" });
    await service.start({ conversationId: "c1", cwd, command: "sleep 60" });
    const reaped: Sink = [];
    const later = makeService(30, reaped);
    await later.reapStaleAtStartup();
    await waitFor(() => reaped.length === 1);
    await sleep(100);
    expect(reaped).toHaveLength(1);
    expect(reaped[0]?.notification.text).toContain("tau restarted");
    await later.stopAll();
  });
});

describe("exit notifications", () => {
  it("notifies on a natural exit with the code and the log tail", async () => {
    await service.start({ conversationId: "c1", cwd, command: "echo a; echo b; exit 2", name: "job" });
    await waitFor(() => sent.length === 1);
    expect(sent[0]?.notification.kind).toBe("app.process_exit");
    expect(dataOf(0)).toMatchObject({ name: "job", exitCode: 2, logTail: "a\nb" });
    expect(sent[0]?.notification.text.startsWith("<process-exit")).toBe(true);
  });

  it("keeps only the last 20 log lines", async () => {
    await service.start({ conversationId: "c1", cwd, command: "seq 1 50" });
    await waitFor(() => sent.length === 1);
    const tail = String(dataOf(0)?.logTail).split("\n");
    expect(tail).toHaveLength(20);
    expect(tail.at(-1)).toBe("50");
  });

  it("does not notify with notifyOnExit false", async () => {
    await service.start({ conversationId: "c1", cwd, command: "echo hi", notifyOnExit: false });
    await sleep(200);
    expect(sent).toEqual([]);
  });

  it("does not notify on stop or on reaping", async () => {
    const info = await service.start({ conversationId: "c1", cwd, command: "sleep 30" });
    await service.stop(info.id);
    await sleep(100);
    expect(sent).toEqual([]);
    const other = makeService();
    await other.start({ conversationId: "c1", cwd, command: "sleep 60" });
    const reaped: Sink = [];
    const later = makeService(30, reaped);
    await later.reapStaleAtStartup();
    await sleep(150);
    expect(reaped).toEqual([]);
    await other.stopAll();
    await later.stopAll();
  });
});
