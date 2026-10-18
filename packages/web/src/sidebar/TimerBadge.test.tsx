import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { hasTimer, TimerBadge } from "./TimerBadge";
import { conversation, renderAt } from "./test-support";

describe("TimerBadge", () => {
  it("marks only threads with a timer", () => {
    expect(hasTimer(conversation({ timers: 1 }))).toBe(true);
    expect(hasTimer(conversation({ timers: 0 }))).toBe(false);
  });

  it("names the next wake-up", () => {
    const nextTimerAt = new Date(Date.now() + 4 * 60_000 + 5_000).toISOString();
    renderAt("/", <TimerBadge conversation={conversation({ timers: 1, nextTimerAt })} />);
    expect(screen.getByRole("img", { name: "Next wake-up in 4 min" })).toBeTruthy();
  });
});
