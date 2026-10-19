import type { Goal } from "@tau/protocol";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOfMachine } from "@/machines/machine-apis";
import { renderAt } from "@/sidebar/test-support";
import { GoalChip } from "./GoalChip";

const api = apiOfMachine();

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  id: "g1",
  condition: "all tests pass",
  state: "active",
  startedAt: Date.now() - 5 * 60_000,
  turnsEvaluated: 2,
  tokensSpent: 1500,
  lastVerdict: "not_met",
  lastReason: "one test fails",
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe("GoalChip", () => {
  it("renders nothing without a goal", async () => {
    const get = vi.spyOn(api.goals, "get").mockResolvedValue(null);
    const { container } = renderAt("/", <GoalChip conversationId="c1" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });

  it.each([
    ["active", "Goal"],
    ["paused", "Goal · paused"],
    ["achieved", "Goal · achieved"],
    ["failed", "Goal · failed"],
  ] as const)("shows the %s state", async (state, text) => {
    vi.spyOn(api.goals, "get").mockResolvedValue(goal({ state }));
    renderAt("/", <GoalChip conversationId="c1" />);
    expect(await screen.findByRole("button", { name: `Goal ${state}` })).toHaveTextContent(text);
  });

  it("opens a popover with the status fields and clears the goal", async () => {
    vi.spyOn(api.goals, "get").mockResolvedValue(goal());
    const clear = vi.spyOn(api.goals, "clear").mockResolvedValue();
    renderAt("/", <GoalChip conversationId="c1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Goal active" }));
    const popover = await screen.findByTestId("goal-popover");
    expect(popover).toHaveTextContent("all tests pass");
    expect(popover).toHaveTextContent("5m");
    expect(popover).toHaveTextContent("one test fails");
    expect(popover).toHaveTextContent("1.5k");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clear).toHaveBeenCalledWith("c1");
  });
});
