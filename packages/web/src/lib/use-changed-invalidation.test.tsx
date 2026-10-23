import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Change } from "@tau/protocol";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LiveClientProvider } from "@/conversation";
import type { LiveClient, LiveStatus } from "@/conversation/live-client";
import { NodeApiProvider } from "@/nodes/node-context";
import { useChangedInvalidation } from "./use-changed-invalidation";

function setup() {
  const listeners = new Set<(status: LiveStatus) => void>();
  const changeListeners = new Set<(change: Change) => void>();
  const live = {
    subscribe: () => () => {},
    onChanged: (listener) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status: "connecting",
    close: () => {},
  } satisfies LiveClient;
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <NodeApiProvider>
        <LiveClientProvider client={live}>{children}</LiveClientProvider>
      </NodeApiProvider>
    </QueryClientProvider>
  );
  renderHook(() => useChangedInvalidation(), { wrapper });
  const emit = (status: LiveStatus) => {
    for (const listener of listeners) listener(status);
  };
  const change = (next: Change) => {
    for (const listener of changeListeners) listener(next);
  };
  return { emit, change, invalidate };
}

describe("useChangedInvalidation", () => {
  it.each([32, 8192])("characterizes advisory invalidations for %s conversation changes", (count) => {
    const { change, invalidate } = setup();
    const start = performance.now();
    for (let i = 0; i < count; i++) change({ resource: "conversations", projectId: "p1" });
    console.log(
      JSON.stringify({
        changes: count,
        invalidations: invalidate.mock.calls.length,
        dispatchMs: performance.now() - start,
        scope: "inactive query client; not network/backend cost",
      }),
    );
    expect(invalidate).toHaveBeenCalledTimes(count * 5);
  });

  it("invalidates the resource activity on a node-wide resources change", () => {
    const { change, invalidate } = setup();
    change({ resource: "resources" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["resources", "activity"] });
  });

  it("does not refetch on the first connection", () => {
    const { emit, invalidate } = setup();
    emit("connecting");
    emit("open");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refetches projects and conversations when the socket reopens after a disconnect", () => {
    const { emit, invalidate } = setup();
    emit("open");
    emit("reconnecting");
    emit("open");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations"] });
    emit("open");
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("refreshes the all-threads list when one project's conversations change", () => {
    const { change, invalidate } = setup();
    change({ resource: "conversations", projectId: "p1" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations", "p1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations", "all"] });
  });

  it("invalidates the GitHub repo list when the projects change", () => {
    const { change, invalidate } = setup();
    change({ resource: "projects" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["github", "repos"] });
  });
});
