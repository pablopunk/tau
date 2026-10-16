import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStickToBottom } from "./use-stick-to-bottom";

function Harness() {
  const { scrollRef, contentRef, atBottom, onScroll, scrollToBottom } = useStickToBottom();
  return (
    <div>
      <div ref={scrollRef} onScroll={onScroll} data-testid="scroller">
        <div ref={contentRef}>content</div>
      </div>
      <span>{atBottom ? "at bottom" : "scrolled up"}</span>
      <button type="button" onClick={scrollToBottom}>
        jump
      </button>
    </div>
  );
}

function scrollerWith(metrics: { scrollHeight: number; clientHeight: number }) {
  const scroller = screen.getByTestId("scroller");
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: metrics.clientHeight });
  return scroller;
}

describe("useStickToBottom", () => {
  it("lets go when the user scrolls up and pins again on jump", () => {
    render(<Harness />);
    const scroller = scrollerWith({ scrollHeight: 1000, clientHeight: 400 });

    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    expect(screen.getByText("scrolled up")).toBeInTheDocument();

    act(() => screen.getByText("jump").click());
    expect(scroller.scrollTop).toBe(1000);
    expect(screen.getByText("at bottom")).toBeInTheDocument();
  });

  it("stays pinned while the user is near the bottom", () => {
    render(<Harness />);
    const scroller = scrollerWith({ scrollHeight: 1000, clientHeight: 400 });
    scroller.scrollTop = 580;
    fireEvent.scroll(scroller);
    expect(screen.getByText("at bottom")).toBeInTheDocument();
  });
});
