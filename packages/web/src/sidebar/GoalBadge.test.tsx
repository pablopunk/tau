import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BotAvatar } from "@/components/ui/bot-avatar";
import { GoalBadge, hasActiveGoal } from "./GoalBadge";
import { conversation, renderAt } from "./test-support";

describe("GoalBadge", () => {
  it("is for threads with an active goal only", () => {
    expect(hasActiveGoal(conversation({ goal: { state: "active", condition: "x" } }))).toBe(true);
    expect(hasActiveGoal(conversation({ goal: { state: "paused", condition: "x" } }))).toBe(false);
    expect(hasActiveGoal(conversation())).toBe(false);
  });

  it("sits on the top right of the avatar and names the goal", () => {
    const thread = conversation({ goal: { state: "active", condition: "all tests pass" } });
    renderAt("/", <BotAvatar avatarIndex={1} goalBadge={<GoalBadge conversation={thread} />} />);
    const badge = screen.getByRole("img", { name: "Goal: all tests pass" });
    expect(badge.parentElement?.className).toContain("-top-1");
    expect(badge.parentElement?.className).toContain("-right-1");
  });
});
