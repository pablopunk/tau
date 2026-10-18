import { screen, waitFor, within } from "@testing-library/react";
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
      iconCandidates: vi.fn(),
      setIcon: vi.fn(),
      resetIcon: vi.fn(),
      remove: vi.fn(),
    },
    conversations: { listAll: vi.fn(), archive: vi.fn(), remove: vi.fn(), rename: vi.fn() },
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
  preferences.setSidebarMode("projects");
  mocked.settings.get.mockResolvedValue({
    defaultModel: null,
    defaultThinkingLevel: null,
    fastModel: null,
    fastThinkingLevel: null,
    projectsFolder: "/projects",
    messageMode: "steer",
    workspaceDefault: "per-project",
    claudeCliNoticeAt: null,
    claudeConnectors: { enabled: [], alwaysAllow: [], askBeforeWrites: false },
    remote: { enabled: false },
  });
  mocked.projects.list.mockResolvedValue([project()]);
  mocked.conversations.listAll.mockResolvedValue([]);
});

describe("sidebar rows", () => {
  it("lists Home first with status dots for running, error and unseen", async () => {
    preferences.getSeenBaseline(100);
    mocked.projects.list.mockResolvedValue([project(), project({ id: "p2", name: "Repo", kind: "folder" })]);
    mocked.conversations.listAll.mockResolvedValue([
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
    const busy = await home.findByRole("link", { name: /Busy/ });
    expect(busy.querySelector("[data-slot=bot-avatar]")?.getAttribute("data-working")).toBe("true");
    expect((await dotOf("Broken"))?.getAttribute("data-status")).toBe("error");
    expect((await dotOf("Fresh"))?.getAttribute("data-status")).toBe("unseen");
    expect(await dotOf("Old")).toBeNull();
  });

  it("does not mark the open thread as unseen", async () => {
    mocked.conversations.listAll.mockResolvedValue([conversation({ lastRunEndedAt: Date.now() + 1000 })]);
    renderSidebar("/p/p1/c/c1");
    const link = await screen.findByRole("link", { name: /First thread/ });
    expect(link.querySelector("[data-slot=status-dot]")).toBeNull();
  });

  it("shows archived threads in a collapsed Archived group", async () => {
    mocked.conversations.listAll.mockResolvedValue([
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
    mocked.conversations.listAll.mockResolvedValue([conversation()]);
    mocked.conversations.archive.mockResolvedValue();
    const user = userEvent.setup();
    renderSidebar();

    await user.click(await screen.findByRole("button", { name: "Actions for First thread" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(mocked.conversations.archive).toHaveBeenCalledWith("c1", true);
  });

  it("confirms a delete, says the transcript stays, and leaves the open thread for /", async () => {
    mocked.conversations.listAll.mockResolvedValue([conversation()]);
    mocked.conversations.remove.mockResolvedValue();
    const user = userEvent.setup();
    renderSidebar("/p/p1/c/c1");

    await user.click(await screen.findByRole("button", { name: "Actions for First thread" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText(/transcript stays on disk/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete thread" }));

    await waitFor(() => expect(mocked.conversations.remove).toHaveBeenCalledWith("c1", { force: false }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
  });
});

describe("sidebar projects", () => {
  it("opens the new thread page for a project", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(await screen.findByRole("button", { name: "New thread in Home" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/new"));
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
