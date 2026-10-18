import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ForkBadge, isFork } from "./ForkBadge";
import { conversation, renderAt } from "./test-support";

const parent = conversation({ id: "1", title: "Parent" });
const forkChild = conversation({ id: "2", parentId: "1", agentType: "fork" });
const userFork = conversation({ id: "3", forkOf: { conversationId: "1", entryId: "7" } });
const plainChild = conversation({ id: "4", parentId: "1", agentType: "general-purpose" });

vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useAllConversations: () => ({ data: [parent, forkChild, userFork, plainChild] }),
}));

describe("ForkBadge", () => {
  it("marks fork subagents and forked threads, not other children", () => {
    expect(isFork(forkChild)).toBe(true);
    expect(isFork(userFork)).toBe(true);
    expect(isFork(plainChild)).toBe(false);
    expect(isFork(parent)).toBe(false);
  });

  it("names the thread it was forked from", () => {
    renderAt(
      "/",
      <TooltipProvider>
        <ForkBadge conversation={userFork} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("img", { name: "Fork of Parent" })).toBeTruthy();
  });
});
