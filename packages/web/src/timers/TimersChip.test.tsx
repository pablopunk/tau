import type { Timer } from "@tau/protocol";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOfMachine } from "@/machines/machine-apis";
import { conversation, renderAt } from "@/sidebar/test-support";
import { TimersChip } from "./TimersChip";

const api = apiOfMachine();

const NOW = Date.now();

const timer = (overrides: Partial<Timer> = {}): Timer => ({
  id: "t1",
  conversationId: "c1",
  kind: "repeat",
  every: "5m",
  prompt: "check the build",
  reason: null,
  source: "agent",
  createdAt: NOW,
  expiresAt: NOW + 7 * 86_400_000,
  nextAt: NOW + 4 * 60_000,
  firedCount: 2,
  ...overrides,
});

function renderChip(timers = 1) {
  vi.spyOn(api.conversations, "listAll").mockResolvedValue([conversation({ id: "c1", timers })]);
  return renderAt("/", <TimersChip conversationId="c1" />);
}

afterEach(() => vi.restoreAllMocks());

describe("TimersChip", () => {
  it("renders nothing for a thread without timers", async () => {
    const list = vi.spyOn(api.timers, "list").mockResolvedValue([]);
    const { container } = renderChip(0);
    await waitFor(() => expect(api.conversations.listAll).toHaveBeenCalled());
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-slot=popover-trigger]")).toBeNull();
  });

  it("shows the count, and lists schedule, next run, fire count and prompt", async () => {
    vi.spyOn(api.timers, "list").mockResolvedValue([timer()]);
    renderChip();
    await userEvent.click(await screen.findByRole("button", { name: "1 timers" }));
    expect(await screen.findByText("check the build")).toBeInTheDocument();
    expect(screen.getByText("every 5m")).toBeInTheDocument();
    expect(screen.getByText(/next in 4 min/)).toBeInTheDocument();
    expect(screen.getByText(/fired 2×/)).toBeInTheDocument();
  });

  it("shows a loading state before the timers arrive", async () => {
    vi.spyOn(api.timers, "list").mockReturnValue(new Promise(() => {}));
    renderChip();
    await userEvent.click(await screen.findByRole("button", { name: "1 timers" }));
    expect(await screen.findByText("Loading timers…")).toBeInTheDocument();
  });

  it("shows an error with a retry that loads the timers", async () => {
    const list = vi
      .spyOn(api.timers, "list")
      .mockRejectedValueOnce(new Error("no connection"))
      .mockResolvedValue([timer({ prompt: "back again" })]);
    renderChip();
    await userEvent.click(await screen.findByRole("button", { name: "1 timers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the timers");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("back again")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("deletes a timer, and a timer deleted elsewhere drops out after a refetch", async () => {
    const list = vi
      .spyOn(api.timers, "list")
      .mockResolvedValue([timer(), timer({ id: "t2", prompt: "second", source: "loop" })]);
    const remove = vi.spyOn(api.timers, "delete").mockResolvedValue();
    const { client } = renderChip(2);
    await userEvent.click(await screen.findByRole("button", { name: "2 timers" }));
    expect(await screen.findByText("/loop")).toBeInTheDocument();
    list.mockResolvedValue([timer({ id: "t2", prompt: "second", source: "loop" })]);
    await userEvent.click(screen.getByRole("button", { name: "Delete timer: check the build" }));
    expect(remove).toHaveBeenCalledWith("t1");
    await waitFor(() => expect(screen.queryByText("check the build")).toBeNull());
    list.mockResolvedValue([]);
    await client.invalidateQueries({ queryKey: ["timers", "c1"] });
    expect(await screen.findByText("No timers.")).toBeInTheDocument();
  });

  it("hides the chip and its popover once the last timer is gone", async () => {
    vi.spyOn(api.timers, "list").mockResolvedValue([timer()]);
    const { client } = renderChip(1);
    await userEvent.click(await screen.findByRole("button", { name: "1 timers" }));
    expect(await screen.findByText("Timers")).toBeInTheDocument();
    vi.spyOn(api.conversations, "listAll").mockResolvedValue([conversation({ id: "c1", timers: 0 })]);
    await client.invalidateQueries({ queryKey: ["conversations"] });
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(screen.queryByText("Timers")).toBeNull();
  });
});
