import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project } from "@tau/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MachineApiProvider } from "@/machines/machine-context";
import { ProjectPicker } from "./ProjectPicker";

const mocks = vi.hoisted(() => ({ add: vi.fn(), clone: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    github: { status: async () => ({ state: "not_installed" }), repos: async () => [] },
    settings: { get: async () => ({ projectsFolder: "/projects" }) },
    projects: { list: async () => [], add: mocks.add, clone: mocks.clone },
  },
}));

const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id,
  name: id,
  path: `/src/${id}`,
  createdAt: 0,
  kind: "folder",
  status: "ready",
  isGitRepo: false,
  ...extra,
});

async function openAddProject(onProject = vi.fn()) {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MachineApiProvider>
        <ProjectPicker
          projects={[project("home", { kind: "home" })]}
          projectId="home"
          onProject={onProject}
          disabled={false}
        />
      </MachineApiProvider>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("combobox", { name: "Project" }));
  await user.click(await screen.findByRole("button", { name: /Add project/ }));
  return { user, onProject };
}

beforeEach(() => vi.resetAllMocks());

describe("add project from the project picker", () => {
  it("clones from the Git URL tab and selects the new project", async () => {
    mocks.clone.mockResolvedValue(project("p3", { kind: "git", status: "cloning" }));
    const { user, onProject } = await openAddProject();
    await user.click(screen.getByRole("tab", { name: "Git URL" }));
    await user.type(screen.getByLabelText("Repository URL"), "https://example.com/a.git");
    await user.type(screen.getByLabelText(/Name/), "Mine");
    await user.click(screen.getByRole("button", { name: "Clone project" }));

    expect(mocks.clone).toHaveBeenCalledWith({ url: "https://example.com/a.git", name: "Mine" });
    await vi.waitFor(() => expect(onProject).toHaveBeenCalledWith("p3"));
  });

  it("adds a folder from the Folder tab and selects it", async () => {
    mocks.add.mockResolvedValue(project("p4"));
    const { user, onProject } = await openAddProject();
    await user.type(screen.getByLabelText("Folder path"), "/tmp/x");
    await user.click(screen.getByRole("button", { name: "Add project" }));

    expect(mocks.add).toHaveBeenCalledWith({ path: "/tmp/x" });
    await vi.waitFor(() => expect(onProject).toHaveBeenCalledWith("p4"));
  });
});
