import { act, fireEvent, render, screen } from "@testing-library/react";
import { Wrench } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { TOOL_AUTO_EXPAND_DELAY_MS, TOOL_AUTO_OPEN_MIN_MS, ToolCard } from "./ToolCard";

function renderCard(status: "pending" | "running" | "done") {
  return render(
    <ToolCard icon={<Wrench />} title="Tool" status={status}>
      <p>details</p>
    </ToolCard>,
  );
}

describe("<ToolCard> auto-expand", () => {
  it("does not expand a fast command that finishes before the delay", () => {
    vi.useFakeTimers();
    try {
      const view = renderCard("running");
      act(() => {
        vi.advanceTimersByTime(TOOL_AUTO_EXPAND_DELAY_MS - 50);
      });
      view.rerender(
        <ToolCard icon={<Wrench />} title="Tool" status="done">
          <p>details</p>
        </ToolCard>,
      );
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText("details")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("expands a running tool after the delay", () => {
    vi.useFakeTimers();
    try {
      renderCard("running");
      expect(screen.queryByText("details")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(TOOL_AUTO_EXPAND_DELAY_MS);
      });
      expect(screen.getByText("details")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an expanded tool open for a minimum time after it finishes", () => {
    vi.useFakeTimers();
    try {
      const view = renderCard("running");
      act(() => {
        vi.advanceTimersByTime(TOOL_AUTO_EXPAND_DELAY_MS);
      });
      expect(screen.getByText("details")).toBeInTheDocument();
      view.rerender(
        <ToolCard icon={<Wrench />} title="Tool" status="done">
          <p>details</p>
        </ToolCard>,
      );
      act(() => {
        vi.advanceTimersByTime(TOOL_AUTO_OPEN_MIN_MS - 100);
      });
      expect(screen.getByText("details")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText("details")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects a manual collapse while running", () => {
    vi.useFakeTimers();
    try {
      renderCard("running");
      act(() => {
        vi.advanceTimersByTime(TOOL_AUTO_EXPAND_DELAY_MS);
      });
      expect(screen.getByText("details")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Tool/ }));
      expect(screen.queryByText("details")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("<ToolCard> subtitle", () => {
  it("exposes the full subtitle as a tooltip and wraps it when open", () => {
    render(
      <ToolCard icon={<Wrench />} title="Tool" subtitle="a very long command" status="done">
        <p>details</p>
      </ToolCard>,
    );
    const subtitle = screen.getByText("a very long command");
    expect(subtitle).toHaveAttribute("title", "a very long command");
    expect(subtitle.className).toContain("group-data-[state=open]/tool:whitespace-pre-wrap");
  });
});
