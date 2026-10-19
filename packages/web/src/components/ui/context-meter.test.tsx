import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ContextMeter } from "./context-meter";

const renderMeter = (used: number) =>
  render(
    <TooltipProvider>
      <ContextMeter used={used} total={100} />
    </TooltipProvider>,
  );

describe("<ContextMeter>", () => {
  it("shows only the ring, with the percentage as its accessible label", () => {
    renderMeter(3);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveTextContent("");
    expect(meter).toHaveAttribute("aria-label", "3%");
  });

  it("is hidden until something is used", () => {
    renderMeter(0);
    expect(screen.queryByRole("meter")).toBeNull();
  });
});
