import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfMachine } from "@/machines/machine-apis";
import { ChangeFolderDialog } from "./ChangeFolderDialog";
import { project, renderAt } from "./test-support";

const api = apiOfMachine();

vi.mock("@/lib/api", () => ({
  api: { projects: { setFolder: vi.fn() }, fs: { suggestDirectories: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const mocked = vi.mocked(api, true);
const repo = project({ id: "p2", name: "Repo", kind: "folder", path: "/old/repo" });

beforeEach(() => {
  vi.resetAllMocks();
  mocked.fs.suggestDirectories.mockResolvedValue([]);
});

describe("ChangeFolderDialog", () => {
  it("shows the current folder and disables confirm until a path is typed", () => {
    renderAt("/", <ChangeFolderDialog project={repo} onClose={vi.fn()} />);
    expect(screen.getByText("/old/repo")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Change folder" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the new folder and closes", async () => {
    mocked.projects.setFolder.mockResolvedValue({ ...repo, path: "/new/repo" });
    const onClose = vi.fn();
    renderAt("/", <ChangeFolderDialog project={repo} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("New folder"), "/new/repo");
    await userEvent.click(screen.getByRole("button", { name: "Change folder" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocked.projects.setFolder).toHaveBeenCalledWith("p2", "/new/repo");
  });

  it("shows the server's refusal inline and stays open", async () => {
    mocked.projects.setFolder.mockRejectedValue(new Error("This folder is not the same repository."));
    const onClose = vi.fn();
    renderAt("/", <ChangeFolderDialog project={repo} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("New folder"), "/other");
    await userEvent.click(screen.getByRole("button", { name: "Change folder" }));
    expect(await screen.findByText(/not the same repository/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
