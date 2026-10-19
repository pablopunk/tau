import { AppError } from "@tau/protocol";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfMachine } from "@/machines/machine-apis";
import { conversation, renderAt } from "@/sidebar/test-support";
import { WorkspaceChip } from "./WorkspaceChip";

const api = apiOfMachine();

vi.mock("@/lib/api", () => ({
  api: {
    conversations: { listAll: vi.fn(), send: vi.fn() },
    workspaces: { status: vi.fn(), merge: vi.fn(), createPullRequest: vi.fn(), remove: vi.fn() },
  },
}));

const mocked = vi.mocked(api, true);

const worktreeThread = conversation({
  id: "c1",
  workspace: {
    mode: "worktree",
    path: "/w/fix",
    branch: "pi/fix",
    base: "main",
    state: "ready",
    mergedSha: null,
    pullRequestUrl: null,
  },
});

const status = {
  ahead: 2,
  behind: 1,
  dirtyFiles: ["a.ts"],
  unmergedCommits: 2,
  canMerge: true,
  reason: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocked.conversations.listAll.mockResolvedValue([worktreeThread]);
  mocked.workspaces.status.mockResolvedValue(status);
});

const open = async () => {
  renderAt("/", <WorkspaceChip conversationId="c1" />);
  await userEvent.click(await screen.findByRole("button", { name: "Workspace" }));
};

describe("WorkspaceChip", () => {
  it("shows the branch, ahead, behind and dirty counts", async () => {
    renderAt("/", <WorkspaceChip conversationId="c1" />);
    expect(await screen.findByText("pi/fix")).toBeTruthy();
    expect(await screen.findByLabelText("2 ahead")).toBeTruthy();
    expect(screen.getByLabelText("1 behind")).toBeTruthy();
    expect(screen.getByText("1 uncommitted")).toBeTruthy();
  });

  it("shows uncommitted, not merged, when the stored state is merged but files are dirty", async () => {
    mocked.conversations.listAll.mockResolvedValue([
      { ...worktreeThread, workspace: { ...worktreeThread.workspace, state: "merged" } },
    ]);
    mocked.workspaces.status.mockResolvedValue({ ...status, ahead: 0, unmergedCommits: 0, behind: 0 });
    renderAt("/", <WorkspaceChip conversationId="c1" />);
    expect(await screen.findByText("1 uncommitted")).toBeTruthy();
    expect(screen.queryByText("merged")).toBeNull();
  });

  it("shows merged when the stored state is merged and the worktree is clean", async () => {
    mocked.conversations.listAll.mockResolvedValue([
      { ...worktreeThread, workspace: { ...worktreeThread.workspace, state: "merged" } },
    ]);
    mocked.workspaces.status.mockResolvedValue({
      ...status,
      ahead: 0,
      unmergedCommits: 0,
      behind: 0,
      dirtyFiles: [],
    });
    renderAt("/", <WorkspaceChip conversationId="c1" />);
    expect(await screen.findByText("merged")).toBeTruthy();
  });

  it("renders nothing for a checkout thread", async () => {
    mocked.conversations.listAll.mockResolvedValue([conversation({ id: "c1" })]);
    const { container } = renderAt("/", <WorkspaceChip conversationId="c1" />);
    await waitFor(() => expect(mocked.conversations.listAll).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });

  it("merges into the base from the menu", async () => {
    mocked.workspaces.merge.mockResolvedValue(worktreeThread);
    await open();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Merge into main" }));
    await waitFor(() => expect(mocked.workspaces.merge).toHaveBeenCalledWith("c1"));
  });

  it("offers Ask agent to commit when the worktree is dirty and sends the canned message", async () => {
    mocked.workspaces.merge.mockRejectedValue(new AppError("worktree_dirty", "Uncommitted changes: a.ts"));
    mocked.conversations.send.mockResolvedValue(undefined as never);
    await open();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Merge into main" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ask agent to commit" }));
    expect(mocked.conversations.send).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ text: expect.stringContaining("commit") }),
    );
  });

  it("offers Ask agent to resolve on a merge conflict", async () => {
    mocked.workspaces.merge.mockRejectedValue(
      new AppError("merge_conflict", "Rebase onto main hit conflicts."),
    );
    mocked.conversations.send.mockResolvedValue(undefined as never);
    await open();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Merge into main" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ask agent to resolve" }));
    expect(mocked.conversations.send).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ text: expect.stringContaining("rebase this branch onto main") }),
    );
  });

  it("confirms removal listing the unmerged work and forces it", async () => {
    mocked.workspaces.remove.mockResolvedValue(worktreeThread);
    await open();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove worktree" }));
    expect(await screen.findByText("a.ts")).toBeTruthy();
    expect(screen.getByText("2 unmerged commit(s)")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove worktree" }));
    await waitFor(() => expect(mocked.workspaces.remove).toHaveBeenCalledWith("c1", true));
  });

  it("creates a pull request from the menu", async () => {
    mocked.workspaces.createPullRequest.mockResolvedValue(worktreeThread);
    await open();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Create PR" }));
    await waitFor(() => expect(mocked.workspaces.createPullRequest).toHaveBeenCalledWith("c1"));
  });
});
