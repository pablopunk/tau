import type { GithubRepo } from "@pi-everywhere/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UseRepoDialog } from "@/github/UseRepoDialog";
import { AddProjectDialog } from "@/sidebar/AddProjectDialog";
import { ProjectsFolderField } from "./ProjectsFolderField";

const mocks = vi.hoisted(() => ({
  suggest: vi.fn(),
  add: vi.fn(),
  use: vi.fn(),
  setProjectsFolder: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    fs: { suggestDirectories: mocks.suggest },
    projects: { add: mocks.add, list: async () => [] },
    github: { use: mocks.use },
    settings: {
      get: async () => ({
        defaultModel: null,
        defaultThinkingLevel: null,
        fastModel: null,
        fastThinkingLevel: null,
        projectsFolder: "/data/projects",
      }),
      setProjectsFolder: mocks.setProjectsFolder,
    },
  },
}));

const sandbox = { path: "/home/me/src/sandbox", display: "~/src/sandbox", isGitRepo: false };
const repo: GithubRepo = {
  nameWithOwner: "me/app",
  description: null,
  private: false,
  pushedAt: 0,
  localPath: null,
  projectId: null,
};

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return userEvent.setup();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.suggest.mockResolvedValue([sandbox]);
  mocks.add.mockResolvedValue({});
  mocks.use.mockResolvedValue({});
  mocks.setProjectsFolder.mockResolvedValue(undefined);
});

describe("Add project dialog, Folder tab", () => {
  it("suggests folders for ~/ and adds the accepted path", async () => {
    const user = wrap(<AddProjectDialog onClose={() => {}} />);
    await user.type(screen.getByRole("combobox", { name: "Folder path" }), "~/sa");
    await user.click(await screen.findByText("~/src/sandbox"));
    await user.click(screen.getByRole("button", { name: "Add project" }));
    expect(mocks.add).toHaveBeenCalledWith({ path: "~/src/sandbox/" });
  });
});

describe("Settings projects folder field", () => {
  it("suggests folders and saves the accepted path", async () => {
    const user = wrap(<ProjectsFolderField />);
    const field = await screen.findByDisplayValue("/data/projects");
    await user.clear(field);
    await user.type(field, "~/sa");
    await screen.findByText("~/src/sandbox");
    await user.keyboard("{Tab}");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.setProjectsFolder).toHaveBeenCalledWith("~/src/sandbox/");
  });
});

describe("Use an existing folder", () => {
  it("suggests folders and uses the accepted path", async () => {
    const user = wrap(<UseRepoDialog repo={repo} onClose={() => {}} onUsed={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Use an existing folder" }));
    await user.type(screen.getByRole("combobox", { name: "Folder path" }), "~/sa");
    await user.click(await screen.findByText("~/src/sandbox"));
    await user.click(screen.getByRole("button", { name: "Use folder" }));
    expect(mocks.use).toHaveBeenCalledWith({
      nameWithOwner: "me/app",
      mode: "folder",
      path: "~/src/sandbox/",
    });
  });
});
