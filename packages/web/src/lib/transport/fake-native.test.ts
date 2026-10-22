import { type ConversationView, nativeEventsOf, readRuntimeLive } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeNative } from "./fake-native";

async function readyCore(native: boolean) {
  const core = createFakeCore({ configured: true });
  await core.providers.setApiKey("openrouter", "fake");
  if (native) installFakeNative(core);
  return core;
}

async function latestView(core: Awaited<ReturnType<typeof readyCore>>, id: string) {
  let view: ConversationView | undefined;
  const watcher = await core.conversations.watch(id, async (ops) => {
    view = ops[0]?.[1] as unknown as ConversationView;
  });
  await watcher.stop();
  if (!view) throw new Error("no view");
  return view;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("fake native scenario", () => {
  it("leaves Claude Code disabled without the flag", async () => {
    const core = await readyCore(false);
    const claude = (await core.runtimes.list()).executors.find((item) => item.executor === "claude-code");
    expect(claude?.enabled).toBe(false);
  });

  it("enables Claude Code with the flag", async () => {
    const core = await readyCore(true);
    const claude = (await core.runtimes.list()).executors.find((item) => item.executor === "claude-code");
    expect(claude).toMatchObject({ enabled: true });
    expect(claude?.capabilities.followUp.supported).toBe(true);
    expect(claude?.capabilities.steer.supported).toBe(false);
  });

  it("starts a native thread with the executor on its summary and native entries in its view", async () => {
    const core = await readyCore(true);
    const summary = await core.conversations.start({
      projectId: "home",
      text: "fix the bug",
      requestId: "start-1",
      executor: "claude-code",
    });
    expect(summary.executor).toBe("claude-code");
    expect((await core.conversations.listAll()).find((item) => item.id === summary.id)?.executor).toBe(
      "claude-code",
    );
    const view = await latestView(core, summary.id);
    expect(nativeEventsOf(view).map((event) => event.type)).toEqual(["session", "user", "lifecycle"]);
    expect(readRuntimeLive(view, "claude-code").busy).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    const settled = readRuntimeLive(await latestView(core, summary.id), "claude-code");
    expect(settled).toMatchObject({ busy: false, lifecycle: "completed" });
  });

  it("appends events for a send and queues it behind a running turn", async () => {
    const core = await readyCore(true);
    const { id } = await core.conversations.start({
      projectId: "home",
      text: "first",
      requestId: "start-2",
      executor: "claude-code",
    });
    await core.conversations.send(id, { text: "second", requestId: "send-1" });
    const queued = readRuntimeLive(await latestView(core, id), "claude-code").queued;
    expect(queued.map((item) => item.text)).toEqual(["second"]);
    await vi.advanceTimersByTimeAsync(5000);
    const after = await latestView(core, id);
    expect(readRuntimeLive(after, "claude-code")).toMatchObject({ queued: [], busy: false });
    expect(nativeEventsOf(after).filter((event) => event.type === "user")).toHaveLength(2);
  });

  it("ends a run as outcome-unknown when the message says so", async () => {
    const core = await readyCore(true);
    const { id } = await core.conversations.start({
      projectId: "home",
      text: "unknown ending",
      requestId: "start-3",
      executor: "claude-code",
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(readRuntimeLive(await latestView(core, id), "claude-code").lifecycle).toBe("outcome-unknown");
  });

  it("refuses attachments like the real core", async () => {
    const core = await readyCore(true);
    await expect(
      core.conversations.start({
        projectId: "home",
        text: "with file",
        requestId: "start-4",
        executor: "claude-code",
        files: [{ id: "f", name: "a.txt", mimeType: "text/plain", size: 1 }],
      } as never),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("stops a running native turn", async () => {
    const core = await readyCore(true);
    const { id } = await core.conversations.start({
      projectId: "home",
      text: "long job",
      requestId: "start-5",
      executor: "claude-code",
    });
    await core.conversations.abort(id);
    expect(readRuntimeLive(await latestView(core, id), "claude-code")).toMatchObject({
      busy: false,
      lifecycle: "cancelled",
    });
  });

  it("keeps ordinary threads on the original path", async () => {
    const core = await readyCore(true);
    const summary = await core.conversations.start({ projectId: "home", text: "hello", requestId: "pi-1" });
    expect(summary.executor).toBeUndefined();
  });
});
