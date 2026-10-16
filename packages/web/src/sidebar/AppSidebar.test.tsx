import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { preferences } from "@/lib/preferences";
import { AppSidebar } from "./AppSidebar";
import { conversation, project, renderAt } from "./test-support";

vi.mock("@/lib/api", () => ({
  api: {
    projects: {
      list: vi.fn(),
      add: vi.fn(),
      clone: vi.fn(),
      retryClone: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
    },
    conversations: { list: vi.fn(), archive: vi.fn(), remove: vi.fn(), rename: vi.fn() },
    settings: { get: vi.fn() },
    provider: { status: vi.fn(), models: vi.fn(), setKey: vi.fn() },
  },
}));

const mocked = vi.mocked(api, true);

const renderSidebar = (path = "/") =>
  renderAt(
    path,
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  mocked.settings.get.mockResolvedValue({ defaultModel: null, fastModel: null, projectsFolder: "/projects" });
  mocked.projects.list.mockResolvedValue([project()]);
  mocked.conversations.list.mockResolvedValue([]);
});

describe("sidebar rows", () => {
  it("lists Home first with status dots for running, error and unseen", async () => {
    preferences.getSeenBaseline(100);
    mocked.projects.list.mockResolvedValue([project(), project({ id: "p2", name: "Repo", kind: "folder" })]);
    mocked.conversations.list.mockResolvedValue([
      conversation({ id: "a", title: "Busy", status: "running" }),
      conversation({ id: "b", title: "Broken", status: "error" }),
      conversation({ id: "c", title: "Fresh", lastRunEndedAt: Date.now() + 1000 }),
      conversation({ id: "d", title: "Old", lastRunEndedAt: 50 }),
    ]);
    renderSidebar();

    const groups = await screen.findAllByRole("group");
    expect(groups[0]).toHaveAccessibleName("Home");
    const home = within(groups[0] as HTMLElement);
    const dotOf = async (title: string) =>
      (await home.findByRole("link", { name: new RegExp(title) })).querySelector("[data-slot=status-dot]");
    expect((await dotOf("Busy"))?.getAttribute("data-status")).toBe("running");
    expect((await dotOf("Broken"))?.getAttribute("data-status")).toBe("error");
    expect((await dotOf("Fresh"))?.getAttribute("data-status")).toBe("unseen");
    expect(await dotOf("Old")).toBeNull();
  });

  it("does not mark the open thread as unseen", async () => {
    mocked.conversations.list.mockResolvedValue([conversation({ lastRunEndedAt: Date.now() + 1000 })]);
    renderSidebar("/p/p1/c/c1");
    const link = await screen.findByRole("link", { name: /First thread/ });
    expect(link.querySelector("[data-slot=status-dot]")).toBeNull();
  });

  it("shows archived threads in a collapsed Archived group", async () => {
    mocked.conversations.list.mockResolvedValue([
      conversation(),
      conversation({ id: "z", title: "Shelved", archivedAt: 5 }),
    ]);
    const user = userEvent.setup();
    renderSidebar();

    await screen.findByRole("link", { name: /First thread/ });
    expect(screen.queryByRole("link", { name: /Shelved/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Archived \(1\)/ }));
    expect(await screen.findByRole("link", { name: /Shelved/ })).toBeInTheDocument();
  });

  it("archives from the row menu", async () => {
    mocked.conversations.list.mockResolvedValue([conversation()]);
    mocked.conversations.archive.mockResolvedValue();
    const user = userEvent.setup();
    renderSidebar();

    await user.click(await screen.findByRole("button", { name: "Actions for First thread" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(mocked.conversations.archive).toHaveBeenCalledWith("c1", true);
  });

  it("confirms a delete, says the transcript stays, and leaves the open thread for /", async () => {
    mocked.conversations.list.mockResolvedValue([conversation()]);
    mocked.conversations.remove.mockResolvedValue();
    const user = userEvent.setup();
    renderSidebar("/p/p1/c/c1");

    await user.click(await screen.findByRole("button", { name: "Actions for First thread" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText(/transcript stays on disk/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete thread" }));

    expect(mocked.conversations.remove).toHaveBeenCalledWith("c1");
    expect(await screen.findByTestId("location")).toHaveTextContent(/^\/$/);
  });
});

describe("sidebar projects", () => {
  it("opens the new thread page for a project", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(await screen.findByRole("button", { name: "New thread in Home" }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/new");
  });

  it("shows a spinner while a project clones", async () => {
    mocked.projects.list.mockResolvedValue([
      project(),
      project({ id: "p2", name: "Repo", kind: "git", status: "cloning" }),
    ]);
    renderSidebar();
    expect(await screen.findByRole("status", { name: "Cloning" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New thread in Repo" })).not.toBeInTheDocument();
  });

  it("shows a failed clone with Retry and Remove", async () => {
    mocked.projects.list.mockResolvedValue([
      project(),
      project({ id: "p2", name: "Repo", kind: "git", status: "failed", error: "no route to host" }),
    ]);
    mocked.projects.retryClone.mockResolvedValue();
    mocked.projects.remove.mockResolvedValue();
    const user = userEvent.setup();
    renderSidebar();

    expect(await screen.findByText("Clone failed")).toBeInTheDocument();
    expect(screen.getByText("no route to host")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocked.projects.retryClone).toHaveBeenCalledWith("p2");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(await screen.findByRole("button", { name: "Remove project" }));
    expect(mocked.projects.remove).toHaveBeenCalledWith("p2");
  });
});

describe("add project dialog", () => {
  it("clones from the Git URL tab and shows the target folder", async () => {
    mocked.projects.clone.mockResolvedValue(project({ id: "p3", kind: "git", status: "cloning" }));
    const user = userEvent.setup();
    renderSidebar();

    await user.click(await screen.findByRole("button", { name: "Add project" }));
    await user.click(screen.getByRole("tab", { name: "Git URL" }));
    expect(await screen.findByText(/Clones into \/projects/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Repository URL"), "https://example.com/a.git");
    await user.type(screen.getByLabelText(/Name/), "Mine");
    await user.click(screen.getByRole("button", { name: "Clone project" }));

    expect(mocked.projects.clone).toHaveBeenCalledWith({ url: "https://example.com/a.git", name: "Mine" });
  });

  it("adds a folder from the Folder tab", async () => {
    mocked.projects.add.mockResolvedValue(project({ id: "p3", kind: "folder" }));
    const user = userEvent.setup();
    renderSidebar();

    await user.click(await screen.findByRole("button", { name: "Add project" }));
    await user.type(screen.getByLabelText("Folder path"), "/tmp/x");
    await user.click(screen.getByRole("button", { name: "Add project", hidden: false }));
    expect(mocked.projects.add).toHaveBeenCalledWith({ path: "/tmp/x" });
  });
});
