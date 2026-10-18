import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimerFiredRow } from "./TimerFiredRow";

describe("TimerFiredRow", () => {
  it("shows a repeat's prompt, its count and the /loop source", () => {
    render(
      <TimerFiredRow
        data={{
          timerId: "t1",
          kind: "repeat",
          prompt: "check the build",
          reason: null,
          source: "loop",
          firedCount: 1,
        }}
      />,
    );
    expect(screen.getByText("check the build")).toBeInTheDocument();
    expect(screen.getByText(/Repeat fired \(2\) · \/loop/)).toBeInTheDocument();
  });

  it("shows a wake-up's reason", () => {
    render(
      <TimerFiredRow
        data={{
          timerId: "t2",
          kind: "wakeup",
          prompt: "look at CI",
          reason: "CI takes 10 min",
          source: "agent",
          firedCount: 0,
        }}
      />,
    );
    expect(screen.getByText(/Wake-up fired · CI takes 10 min/)).toBeInTheDocument();
  });
});
