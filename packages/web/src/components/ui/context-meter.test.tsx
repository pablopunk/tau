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
  it("always prints its percentage so it reads as a gauge", () => {
    renderMeter(3);
    expect(screen.getByRole("meter")).toHaveTextContent("3%");
  });

  it("is hidden until something is used", () => {
    renderMeter(0);
    expect(screen.queryByRole("meter")).toBeNull();
  });
});
