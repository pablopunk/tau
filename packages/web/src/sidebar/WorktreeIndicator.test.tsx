import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfMachine } from "@/machines/machine-apis";
import { conversation, renderAt } from "@/sidebar/test-support";
import { WorktreeIndicator } from "./WorktreeIndicator";

const api = apiOfMachine();

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

const cleanStatus = { ...status, ahead: 0, unmergedCommits: 0, behind: 0, dirtyFiles: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocked.workspaces.status.mockResolvedValue(status);
});

describe("WorktreeIndicator", () => {
  it("shows ahead, behind and dirty as icons and numbers, never words", async () => {
    renderAt("/", <WorktreeIndicator conversation={worktreeThread} />);
    const indicator = await screen.findByRole("img", {
      name: "pi/fix → main · 2 ahead · 1 behind · 1 uncommitted",
    });
    expect(within(indicator).getByText("↑2")).toBeTruthy();
    expect(within(indicator).getByText("↓1")).toBeTruthy();
    expect(within(indicator).getByText("1")).toBeTruthy();
    expect(indicator.querySelector(".lucide-pencil")).toBeTruthy();
    expect(within(indicator).queryByText(/uncommitted|merged|pi\/fix/)).toBeNull();
  });

  it("shows only a muted branch icon for a clean worktree", async () => {
    mocked.workspaces.status.mockResolvedValue(cleanStatus);
    renderAt("/", <WorktreeIndicator conversation={worktreeThread} />);
    const indicator = await screen.findByRole("img", { name: "pi/fix → main · clean" });
    expect(indicator.querySelector(".lucide-git-branch")).toBeTruthy();
    expect(indicator.textContent).toBe("");
  });

  it("uses a green merge icon without text after merging", async () => {
    mocked.workspaces.status.mockResolvedValue(cleanStatus);
    renderAt(
      "/",
      <WorktreeIndicator
        conversation={{ ...worktreeThread, workspace: { ...worktreeThread.workspace, state: "merged" } }}
      />,
    );
    const indicator = await screen.findByRole("img", { name: "pi/fix → main · merged" });
    expect(indicator.querySelector(".lucide-git-merge")).toBeTruthy();
    expect(indicator.textContent).toBe("");
  });

  it("returns to an amber branch and marks new work after a merge", async () => {
    mocked.workspaces.status.mockResolvedValue({ ...cleanStatus, dirtyFiles: ["new.ts"] });
    renderAt(
      "/",
      <WorktreeIndicator
        conversation={{ ...worktreeThread, workspace: { ...worktreeThread.workspace, state: "merged" } }}
      />,
    );
    const indicator = await screen.findByRole("img", { name: "pi/fix → main · 1 uncommitted" });
    expect(indicator.querySelector(".lucide-git-branch")).toBeTruthy();
    expect(indicator.querySelector(".lucide-pencil")).toBeTruthy();
    expect(indicator.textContent).toBe("1");
  });

  it("uses icons for an archived warning without a status query", async () => {
    renderAt(
      "/",
      <WorktreeIndicator
        conversation={{
          ...worktreeThread,
          unmergedWarning: "Uncommitted changes and unmerged commits in pi/fix",
        }}
      />,
    );
    const indicator = screen.getByRole("img", {
      name: "Uncommitted changes and unmerged commits in pi/fix",
    });
    expect(indicator.querySelector(".lucide-pencil")).toBeTruthy();
    expect(indicator.querySelector(".lucide-arrow-up")).toBeTruthy();
    expect(indicator.textContent).toBe("");
    await waitFor(() => expect(mocked.workspaces.status).not.toHaveBeenCalled());
  });

  it("renders nothing for checkout and removed worktrees", async () => {
    const { container } = renderAt("/", <WorktreeIndicator conversation={conversation()} />);
    await waitFor(() => expect(mocked.workspaces.status).not.toHaveBeenCalled());
    expect(container.querySelector('[role="img"]')).toBeNull();
    const removed = renderAt(
      "/",
      <WorktreeIndicator
        conversation={{ ...worktreeThread, workspace: { ...worktreeThread.workspace, state: "removed" } }}
      />,
    );
    await waitFor(() => expect(mocked.workspaces.status).not.toHaveBeenCalled());
    expect(removed.container.querySelector('[role="img"]')).toBeNull();
  });
});
