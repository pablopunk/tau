import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfNode } from "@/nodes/node-apis";
import { endOf, renderView } from "../test-utils";

const api = apiOfNode();

vi.mock("@/lib/api", () => ({
  api: {
    conversations: {
      send: vi.fn(),
      abort: vi.fn(),
      retry: vi.fn(),
      listAll: vi.fn(),
      configure: vi.fn(),
      updateTodos: vi.fn(),
    },
    models: { list: vi.fn() },
    timers: { list: vi.fn(), delete: vi.fn() },
    processes: { list: vi.fn() },
    goals: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(api.conversations.listAll)
    .mockReset()
    .mockResolvedValue([{ id: "2", title: "Fix the bug", projectId: "home" }] as never);
  vi.mocked(api.models.list).mockReset().mockRejectedValue(new Error("offline"));
  vi.mocked(api.timers.list).mockReset().mockResolvedValue([]);
  vi.mocked(api.processes.list).mockReset().mockResolvedValue([]);
  vi.mocked(api.goals.get).mockReset().mockResolvedValue(null);
});

describe("conversation sidebar", () => {
  it("shows the sidebar with a gallery of the conversation images", async () => {
    renderView(endOf("image"));
    const sidebar = await screen.findByTestId("conversation-sidebar");
    expect(within(sidebar).getByRole("list", { name: "Conversation images" })).toBeInTheDocument();
  });

  it("hides sections that have nothing to show", async () => {
    renderView(endOf("text"));
    const sidebar = await screen.findByTestId("conversation-sidebar");
    await waitFor(() => {
      expect(within(sidebar).queryByText("Todos")).not.toBeInTheDocument();
      expect(within(sidebar).queryByText("Timers")).not.toBeInTheDocument();
      expect(within(sidebar).queryByText("Processes")).not.toBeInTheDocument();
      expect(within(sidebar).queryByText("Images")).not.toBeInTheDocument();
    });
  });

  it("edits todos from the sidebar like the composer panel", async () => {
    renderView(endOf("todo"));
    const sidebar = await screen.findByTestId("conversation-sidebar");
    await userEvent.click(within(sidebar).getByRole("button", { name: "Edit todos" }));
    expect(within(sidebar).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("edits the goal from the sidebar", async () => {
    vi.mocked(api.goals.get).mockResolvedValue({
      id: "g",
      condition: "Ship the release",
      state: "active",
      startedAt: Date.now(),
      turnsEvaluated: 1,
      tokensSpent: 100,
      lastVerdict: null,
      lastReason: null,
    });
    vi.mocked(api.goals.set).mockReset().mockResolvedValue(undefined);
    renderView(endOf("text"));
    const sidebar = await screen.findByTestId("conversation-sidebar");
    await userEvent.click(await within(sidebar).findByRole("button", { name: "Edit goal" }));
    const box = within(sidebar).getByRole("textbox", { name: "Goal condition" });
    await userEvent.clear(box);
    await userEvent.type(box, "Ship it faster");
    await userEvent.click(within(sidebar).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(vi.mocked(api.goals.set)).toHaveBeenCalledWith("2", "Ship it faster"));
  });

  it("opens the sidebar from a collapsed-view indicator", async () => {
    vi.mocked(api.goals.get).mockResolvedValue({
      id: "g",
      condition: "Ship the release",
      state: "active",
      startedAt: Date.now(),
      turnsEvaluated: 1,
      tokensSpent: 100,
      lastVerdict: null,
      lastReason: null,
    });
    renderView(endOf("text"));
    await screen.findByTestId("conversation-sidebar");
    await userEvent.click(screen.getByRole("button", { name: "Close conversation sidebar" }));
    expect(screen.queryByTestId("conversation-sidebar")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Goal active" }));
    const sidebar = await screen.findByTestId("conversation-sidebar");
    expect(within(sidebar).getByText("Ship the release")).toBeInTheDocument();
  });

  it("toggles closed and brings the header chips back", async () => {
    withWorktree();
    renderView(endOf("text"));
    await screen.findByTestId("conversation-sidebar");
    expect(screen.queryByRole("button", { name: "Workspace" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close conversation sidebar" }));
    expect(screen.queryByTestId("conversation-sidebar")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Workspace" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open conversation sidebar" }));
    expect(await screen.findByTestId("conversation-sidebar")).toBeInTheDocument();
  });
});

function withWorktree() {
  vi.mocked(api.conversations.listAll).mockResolvedValue([
    {
      id: "2",
      title: "Fix the bug",
      projectId: "home",
      workspace: {
        mode: "worktree",
        path: "/tmp/wt",
        branch: "fix",
        base: "main",
        state: "ready",
        mergedSha: null,
        pullRequestUrl: null,
      },
    },
  ] as never);
}
