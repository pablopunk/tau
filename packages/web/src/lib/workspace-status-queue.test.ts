import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "./api";
import { createHttpTransport } from "./transport/http";
import { createLazyTransport } from "./transport/lazy";
import { createWorkspaceStatusQueue } from "./workspace-status-queue";

const status = { ahead: 1, behind: 0, dirtyFiles: [], unmergedCommits: 1, canMerge: true, reason: null };
const response = () =>
  new Response(JSON.stringify(status), { headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function blockingFetch() {
  const releases: Array<() => void> = [];
  const fetch = vi.fn(
    (_url: string, options?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        releases.push(() => resolve(response()));
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return { fetch, releases };
}

describe("workspace status admission", () => {
  it("limits cold fanout to two, while ordinary calls and other nodes bypass the queue", async () => {
    const { fetch, releases } = blockingFetch();
    const local = createApi(createHttpTransport());
    const remote = createApi(createHttpTransport({ prefix: "/api/n/remote" }));
    const pending = [
      local.workspaces.status("1"),
      local.workspaces.status("2"),
      local.workspaces.status("3"),
    ];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ submissionId: 9 }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await local.conversations.send("1", { text: "hi", requestId: "r1" });
    const other = remote.workspaces.status("1");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    releases[0]?.();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    for (const release of releases) release();
    await Promise.all([...pending, other]);
  });

  it("cancels queued work before fetch and forwards active cancellation through lazy transport", async () => {
    const { fetch, releases } = blockingFetch();
    const api = createApi(createLazyTransport(async () => createHttpTransport()));
    const active = new AbortController();
    const queued = new AbortController();
    const first = api.workspaces.status("1", { signal: active.signal });
    const firstCheck = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = api.workspaces.status("2");
    const third = api.workspaces.status("3", { signal: queued.signal });
    const thirdCheck = expect(third).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    queued.abort();
    active.abort();
    await Promise.all([firstCheck, thirdCheck]);
    expect(fetch).toHaveBeenCalledTimes(2);
    releases[1]?.();
    await second;
  });

  it("recovers slots after synchronous errors and rejects already-aborted requests", async () => {
    const queue = createWorkspaceStatusQueue();
    await expect(
      queue(() => {
        throw new Error("oops");
      }),
    ).rejects.toThrow("oops");
    const controller = new AbortController();
    controller.abort();
    const read = vi.fn().mockResolvedValue(1);
    await expect(queue(read, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(read).not.toHaveBeenCalled();
    expect(await queue(read)).toBe(1);
  });

  it("does not require AbortSignal.any or AbortSignal.timeout", async () => {
    vi.stubGlobal("AbortSignal", {});
    const queue = createWorkspaceStatusQueue();
    const controller = new AbortController();
    expect(await queue(async () => 1, controller.signal)).toBe(1);
    expect(await queue(async () => 2)).toBe(2);
  });

  it("releases slots after request setup throws", async () => {
    const queue = createWorkspaceStatusQueue();
    vi.stubGlobal(
      "AbortController",
      class {
        constructor() {
          throw new Error("setup failed");
        }
      },
    );
    await expect(queue(async () => 1)).rejects.toThrow("setup failed");
    await expect(queue(async () => 1)).rejects.toThrow("setup failed");
    vi.unstubAllGlobals();
    expect(await queue(async () => 2)).toBe(2);
  });

  it("times out stalled active fetches and admits the next request", async () => {
    vi.useFakeTimers();
    const queue = createWorkspaceStatusQueue();
    const stalled = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const a = expect(queue(stalled)).rejects.toMatchObject({ name: "TimeoutError" });
    const b = expect(queue(stalled)).rejects.toMatchObject({ name: "TimeoutError" });
    const next = queue(async () => 3);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([a, b]);
    expect(await next).toBe(3);
  });
});
