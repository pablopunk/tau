import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { conversation, renderAt } from "@/sidebar/test-support";
import { WorktreeIndicator } from "./WorktreeIndicator";

vi.mock("@/lib/api", () => ({
  api: {
    conversations: { listAll: vi.fn() },
    workspaces: { status: vi.fn() },
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

describe("WorktreeIndicator", () => {
  it("mirrors ahead, behind and dirty counts like the top-bar chip", async () => {
    renderAt("/", <WorktreeIndicator conversation={worktreeThread} />);
    expect(await screen.findByText(/↑2/)).toBeTruthy();
    expect(screen.getByText(/↓1/)).toBeTruthy();
    expect(screen.getByText(/1 uncommitted/)).toBeTruthy();
  });

  it("says clean instead of zero counts when the worktree has nothing to merge", async () => {
    mocked.workspaces.status.mockResolvedValue({
      ...status,
      ahead: 0,
      unmergedCommits: 0,
      behind: 0,
      dirtyFiles: [],
    });
    renderAt("/", <WorktreeIndicator conversation={worktreeThread} />);
    expect(await screen.findByLabelText("pi/fix → main · clean")).toBeTruthy();
  });

  it("shows merged when the stored state is merged and the worktree is clean", async () => {
    mocked.workspaces.status.mockResolvedValue({
      ...status,
      ahead: 0,
      unmergedCommits: 0,
      behind: 0,
      dirtyFiles: [],
    });
    renderAt(
      "/",
      <WorktreeIndicator
        conversation={{
          ...worktreeThread,
          workspace: { ...worktreeThread.workspace, state: "merged" },
        }}
      />,
    );
    expect(await screen.findByText("merged")).toBeTruthy();
  });

  it("shows the archived warning without a status query", async () => {
    renderAt(
      "/",
      <WorktreeIndicator
        conversation={{ ...worktreeThread, unmergedWarning: "Uncommitted changes in pi/fix" }}
      />,
    );
    expect(await screen.findByLabelText("Uncommitted changes in pi/fix")).toBeTruthy();
    await waitFor(() => expect(mocked.workspaces.status).not.toHaveBeenCalled());
  });

  it("renders nothing for checkout and removed worktrees", async () => {
    const { container } = renderAt("/", <WorktreeIndicator conversation={conversation()} />);
    await waitFor(() => expect(mocked.workspaces.status).not.toHaveBeenCalled());
    expect(container.querySelector('[role="img"]')).toBeNull();
    const removed = renderAt(
      "/",
      <WorktreeIndicator
        conversation={{
          ...worktreeThread,
          workspace: { ...worktreeThread.workspace, state: "removed" },
        }}
      />,
    );
    await waitFor(() => expect(mocked.workspaces.status).not.toHaveBeenCalled());
    expect(removed.container.querySelector('[role="img"]')).toBeNull();
  });
});
