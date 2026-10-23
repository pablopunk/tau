import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveClientProvider } from "@/conversation";
import { createStubLiveClient } from "@/conversation/test-utils";
import type { Api } from "@/lib/api";
import { NodeApiProvider } from "@/nodes/node-context";
import { useWarmOnIntent } from "./use-warm-on-intent";

function Row() {
  return (
    <div {...useWarmOnIntent("c1").handlers}>
      <button type="button">row</button>
      <button type="button">actions</button>
    </div>
  );
}

function setup(withLiveClient = true) {
  const client = createStubLiveClient();
  client.warm = vi.fn();
  const api = {
    approvals: { list: vi.fn().mockResolvedValue([]) },
    goals: { get: vi.fn().mockResolvedValue(null) },
    workspaces: { status: vi.fn().mockResolvedValue(null) },
    timers: { list: vi.fn().mockResolvedValue([]) },
    processes: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as Api;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NodeApiProvider api={api}>
        {withLiveClient ? (
          <LiveClientProvider client={client}>
            <Row />
          </LiveClientProvider>
        ) : (
          <Row />
        )}
      </NodeApiProvider>
    </QueryClientProvider>,
  );
  return { api, client };
}

describe("useWarmOnIntent", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("warms on press at once", async () => {
    const { api, client } = setup();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).pointer({
      keys: "[MouseLeft>]",
      target: screen.getByText("row"),
    });
    expect(client.warm).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledWith("c1"));
  });

  it("reuses fresh prefetches when a hover dwell is followed by a press", async () => {
    const { api, client } = setup();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const row = screen.getByText("row");

    await user.hover(row);
    act(() => vi.advanceTimersByTime(150));
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledTimes(1));
    await user.click(row);
    act(() => vi.advanceTimersByTime(150));

    expect(client.warm).toHaveBeenCalledTimes(2);
    expect(api.approvals.list).toHaveBeenCalledTimes(1);
  });

  it("warms again on press after the idle view can expire", async () => {
    const { api, client } = setup();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const row = screen.getByText("row");

    await user.hover(row);
    act(() => vi.advanceTimersByTime(150));
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledTimes(1));
    act(() => vi.advanceTimersByTime(130_000));
    await user.click(row);

    expect(client.warm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledTimes(2));
  });

  it("keeps one warm across focus moving between controls in the same row", async () => {
    const { client, api } = setup();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.tab();
    act(() => vi.advanceTimersByTime(150));
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledTimes(1));
    await user.tab();
    act(() => vi.advanceTimersByTime(150));

    expect(client.warm).toHaveBeenCalledTimes(1);
    expect(api.approvals.list).toHaveBeenCalledTimes(1);
  });

  it("warms after a short hover, not on a pass-through", async () => {
    const { api, client } = setup();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.hover(screen.getByText("row"));
    expect(client.warm).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(client.warm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.processes.list).toHaveBeenCalledWith("c1"));
    await user.unhover(screen.getByText("row"));
    await user.hover(screen.getByText("row"));
    await user.unhover(screen.getByText("row"));
    act(() => vi.advanceTimersByTime(300));
    expect(client.warm).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a live client", () => {
    setup(false);
    expect(() =>
      screen.getByText("row").dispatchEvent(new Event("pointerdown", { bubbles: true })),
    ).not.toThrow();
    expect(screen.getByText("row")).toBeInTheDocument();
  });
});
