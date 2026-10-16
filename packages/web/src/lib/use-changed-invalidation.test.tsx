import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LiveClientProvider } from "@/conversation";
import type { LiveClient, LiveStatus } from "@/conversation/live-client";
import { useChangedInvalidation } from "./use-changed-invalidation";

function setup() {
  const listeners = new Set<(status: LiveStatus) => void>();
  const live = {
    subscribe: () => () => {},
    onChanged: () => () => {},
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
      <LiveClientProvider client={live}>{children}</LiveClientProvider>
    </QueryClientProvider>
  );
  renderHook(() => useChangedInvalidation(), { wrapper });
  const emit = (status: LiveStatus) => {
    for (const listener of listeners) listener(status);
  };
  return { emit, invalidate };
}

describe("useChangedInvalidation", () => {
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
});
