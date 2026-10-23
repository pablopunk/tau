import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveClientProvider } from "@/conversation";
import { createStubLiveClient } from "@/conversation/test-utils";
import { useWarmOnIntent } from "./use-warm-on-intent";

function Row() {
  return (
    <button type="button" {...useWarmOnIntent("c1")}>
      row
    </button>
  );
}

function setup() {
  const client = createStubLiveClient();
  client.warm = vi.fn();
  render(
    <LiveClientProvider client={client}>
      <Row />
    </LiveClientProvider>,
  );
  return client;
}

describe("useWarmOnIntent", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("warms on press at once", async () => {
    const client = setup();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).pointer({
      keys: "[MouseLeft>]",
      target: screen.getByText("row"),
    });
    expect(client.warm).toHaveBeenCalledWith("c1");
  });

  it("warms after a short hover, not on a pass-through", async () => {
    const client = setup();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.hover(screen.getByText("row"));
    expect(client.warm).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(client.warm).toHaveBeenCalledTimes(1);
    await user.unhover(screen.getByText("row"));
    await user.hover(screen.getByText("row"));
    await user.unhover(screen.getByText("row"));
    act(() => vi.advanceTimersByTime(300));
    expect(client.warm).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a live client", () => {
    render(<Row />);
    expect(() =>
      screen.getByText("row").dispatchEvent(new Event("pointerdown", { bubbles: true })),
    ).not.toThrow();
  });
});
