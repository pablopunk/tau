import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOfMachine } from "@/machines/machine-apis";
import { runGoalCommand } from "./goal-command";

const api = apiOfMachine();

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

const client = () => new QueryClient();

afterEach(() => vi.restoreAllMocks());

describe("runGoalCommand", () => {
  it("sets a goal from the arguments", async () => {
    const set = vi.spyOn(api.goals, "set").mockResolvedValue();
    await runGoalCommand(api, "c1", "all tests pass", client());
    expect(set).toHaveBeenCalledWith("c1", "all tests pass");
  });

  it.each(["clear", "stop", "off", "reset", "none", "cancel"])("%s clears the goal", async (word) => {
    const clear = vi.spyOn(api.goals, "clear").mockResolvedValue();
    await runGoalCommand(api, "c1", word, client());
    expect(clear).toHaveBeenCalledWith("c1");
  });

  it("shows the status without arguments", async () => {
    vi.spyOn(api.goals, "get").mockResolvedValue({
      id: "g",
      condition: "tests pass",
      state: "active",
      startedAt: Date.now(),
      turnsEvaluated: 1,
      tokensSpent: 10,
      lastVerdict: "not_met",
      lastReason: "one fails",
    });
    await runGoalCommand(api, "c1", "", client());
    expect(toast.info).toHaveBeenCalledWith("Goal", {
      description: expect.stringContaining("Last reason: one fails"),
    });
  });

  it("rejects a condition over 4,000 characters without calling the core", async () => {
    const set = vi.spyOn(api.goals, "set").mockResolvedValue();
    await runGoalCommand(api, "c1", "x".repeat(4001), client());
    expect(set).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
