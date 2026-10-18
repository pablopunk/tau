import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UnmergedWarning } from "./UnmergedWarning";

const badgeFor = (message: string) => {
  render(
    <TooltipProvider>
      <UnmergedWarning message={message} />
    </TooltipProvider>,
  );
  return screen.getByTestId("unmerged-warning").textContent;
};

describe("UnmergedWarning", () => {
  it("names uncommitted changes", () => {
    expect(badgeFor("Uncommitted changes in pi/x")).toBe("Uncommitted changes");
  });

  it("names unmerged commits", () => {
    expect(badgeFor("Unmerged commits in pi/x")).toBe("Unmerged commits");
  });
});
