import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GoalVerdictRow } from "./GoalVerdictRow";

const data = { goalId: "g", verdict: "not_met", reason: "one test still fails", turnsEvaluated: 1 } as const;

describe("GoalVerdictRow", () => {
  it("shows a compact row and expands to the reason", async () => {
    render(<GoalVerdictRow data={data} />);
    expect(screen.getByTestId("goal-verdict")).toHaveTextContent(
      "Goal check: not met — one test still fails",
    );
    expect(screen.getAllByText(/one test still fails/)).toHaveLength(1);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getAllByText(/one test still fails/)).toHaveLength(2);
  });

  it("names the met and impossible verdicts", () => {
    const { rerender } = render(<GoalVerdictRow data={{ ...data, verdict: "met" }} />);
    expect(screen.getByTestId("goal-verdict")).toHaveTextContent("Goal check: met");
    rerender(<GoalVerdictRow data={{ ...data, verdict: "impossible" }} />);
    expect(screen.getByTestId("goal-verdict")).toHaveTextContent("Goal check: impossible");
  });
});
