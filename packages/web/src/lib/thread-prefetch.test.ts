import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "./api";
import { queryKeys } from "./queries";
import { prefetchThreadData } from "./thread-prefetch";

function setup() {
  const api = {
    approvals: { list: vi.fn().mockResolvedValue([]) },
    goals: { get: vi.fn().mockResolvedValue(null) },
    workspaces: { status: vi.fn().mockResolvedValue(null) },
    timers: { list: vi.fn().mockResolvedValue([]) },
    processes: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as Api;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { api, queryClient };
}

afterEach(() => vi.restoreAllMocks());

describe("prefetchThreadData", () => {
  it("prefetches per-thread data and skips checkpoints", async () => {
    const { api, queryClient } = setup();

    prefetchThreadData(queryClient, api, "c1");

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.approvals("c1"))).toEqual([]);
      expect(queryClient.getQueryData(queryKeys.goal("c1"))).toBeNull();
      expect(queryClient.getQueryData(queryKeys.workspace("c1"))).toBeNull();
      expect(queryClient.getQueryData(queryKeys.timers("c1"))).toEqual([]);
      expect(queryClient.getQueryData(queryKeys.processes("c1"))).toEqual([]);
    });
    expect(queryClient.getQueryState(queryKeys.checkpoints("c1"))).toBeUndefined();
  });

  it("skips queries that are already fresh", async () => {
    const { api, queryClient } = setup();

    prefetchThreadData(queryClient, api, "c1");
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.processes("c1"))).toEqual([]));

    prefetchThreadData(queryClient, api, "c1");
    await Promise.resolve();

    expect(api.approvals.list).toHaveBeenCalledTimes(1);
    expect(api.goals.get).toHaveBeenCalledTimes(1);
    expect(api.workspaces.status).toHaveBeenCalledTimes(1);
    expect(api.timers.list).toHaveBeenCalledTimes(1);
    expect(api.processes.list).toHaveBeenCalledTimes(1);
  });

  it("swallows asynchronous query failures", async () => {
    const { api, queryClient } = setup();
    vi.mocked(api.approvals.list).mockRejectedValue(new Error("offline"));

    expect(() => prefetchThreadData(queryClient, api, "c1")).not.toThrow();
    await waitFor(() => expect(queryClient.getQueryState(queryKeys.approvals("c1"))?.status).toBe("error"));
    expect(queryClient.getQueryData(queryKeys.goal("c1"))).toBeNull();
  });

  it("never throws when query prefetching throws synchronously", () => {
    const { api, queryClient } = setup();
    const prefetch = vi.spyOn(queryClient, "prefetchQuery").mockImplementation(() => {
      throw new Error("prefetch failed");
    });

    expect(() => prefetchThreadData(queryClient, api, "c1")).not.toThrow();
    expect(prefetch).toHaveBeenCalledTimes(5);
  });
});
