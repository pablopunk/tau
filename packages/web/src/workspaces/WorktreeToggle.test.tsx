import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { project, renderAt } from "@/sidebar/test-support";
import { WorktreeToggle } from "./WorktreeToggle";

vi.mock("@/lib/api", () => ({
  api: { projects: { list: vi.fn() }, settings: { get: vi.fn() } },
}));

const mocked = vi.mocked(api, true);

const settings = (workspaceDefault: "worktree" | "checkout") =>
  ({ workspaceDefault }) as Awaited<ReturnType<typeof api.settings.get>>;

beforeEach(() => {
  vi.resetAllMocks();
  mocked.projects.list.mockResolvedValue([
    project({ id: "g", kind: "folder", isGitRepo: true }),
    project({ id: "f", kind: "folder" }),
  ]);
  mocked.settings.get.mockResolvedValue(settings("worktree"));
});

describe("WorktreeToggle", () => {
  it("follows the settings default until the user chooses", async () => {
    mocked.settings.get.mockResolvedValue(settings("checkout"));
    renderAt("/", <WorktreeToggle projectId="g" value={null} onChange={() => {}} />);
    const checkout = await screen.findByRole("radio", { name: "Main checkout" });
    await waitFor(() => expect(checkout.getAttribute("aria-checked")).toBe("true"));
  });

  it("reports the chosen mode", async () => {
    const onChange = vi.fn();
    renderAt("/", <WorktreeToggle projectId="g" value="worktree" onChange={onChange} />);
    await userEvent.click(await screen.findByRole("radio", { name: "Main checkout" }));
    expect(onChange).toHaveBeenCalledWith("checkout");
  });

  it("is hidden for projects that are not git repositories", async () => {
    const { container } = renderAt("/", <WorktreeToggle projectId="f" value={null} onChange={() => {}} />);
    await waitFor(() => expect(mocked.projects.list).toHaveBeenCalled());
    expect(container.querySelector("[data-slot=toggle-group]")).toBeNull();
  });
});
