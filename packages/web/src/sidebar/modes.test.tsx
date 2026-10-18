import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { preferences } from "@/lib/preferences";
import { AppSidebar } from "./AppSidebar";
import { conversation, project, renderAt } from "./test-support";

vi.mock("@/lib/api", () => ({
  api: {
    projects: { list: vi.fn(), retryClone: vi.fn(), remove: vi.fn(), iconCandidates: vi.fn() },
    conversations: { listAll: vi.fn() },
    settings: { get: vi.fn() },
  },
}));

const mocked = vi.mocked(api, true);
const repo = project({ id: "p2", name: "Repo", kind: "folder", path: "/Users/me/src/repo" });
const THREAD_TITLES = ["Alpha", "Bravo", "Charlie"];

const threadOrder = () =>
  screen
    .getAllByRole("link")
    .map((link) => THREAD_TITLES.find((title) => link.textContent?.includes(title)))
    .filter(Boolean);

const renderSidebar = (path = "/") =>
  renderAt(
    path,
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );

const stubReducedMotion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  mocked.settings.get.mockResolvedValue({
    defaultModel: null,
    defaultThinkingLevel: null,
    fastModel: null,
    fastThinkingLevel: null,
    projectsFolder: "/p",
    messageMode: "steer",
    workspaceDefault: "per-project",
    claudeCliNoticeAt: null,
    claudeConnectors: { enabled: [], alwaysAllow: [] },
  });
  mocked.projects.list.mockResolvedValue([project(), repo]);
  mocked.conversations.listAll.mockResolvedValue([
    conversation({ id: "a", title: "Alpha", lastActivityAt: 10 }),
    conversation({ id: "b", title: "Bravo", projectId: "p2", lastActivityAt: 30 }),
    conversation({ id: "c", title: "Charlie", projectId: "p2", lastActivityAt: 30 }),
    conversation({ id: "z", title: "Shelved", archivedAt: 5, lastActivityAt: 40 }),
  ]);
});

afterEach(() => vi.unstubAllGlobals());

describe("threads mode", () => {
  it("is the default and sorts by lastActivityAt then id descending, with project context", async () => {
    renderSidebar();
    await screen.findByRole("link", { name: /Alpha/ });
    expect(threadOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(within(screen.getByRole("link", { name: /Bravo/ })).getByText("Repo")).toBeInTheDocument();
  });

  it("keeps the project icon and name on the current row", async () => {
    renderSidebar("/p/p2/c/b");
    const link = await screen.findByRole("link", { name: /Bravo/ });
    expect(link.closest("[data-current]")?.getAttribute("data-current")).toBe("true");
    expect(within(link).getByText("Repo")).toBeInTheDocument();
    expect(link.querySelector("[data-slot=project-icon]")).not.toBeNull();
  });

  it("keeps one Archived section at the bottom", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(await screen.findByRole("button", { name: /Archived \(1\)/ }));
    expect(await screen.findByRole("link", { name: /Shelved/ })).toBeInTheDocument();
  });

  it("shows cloning and failed projects as status rows with Retry and Remove", async () => {
    mocked.projects.list.mockResolvedValue([
      project(),
      project({ id: "p3", name: "Cloning", kind: "git", status: "cloning" }),
      project({ id: "p4", name: "Broken", kind: "git", status: "failed", error: "nope" }),
    ]);
    mocked.projects.retryClone.mockResolvedValue();
    const user = userEvent.setup();
    renderSidebar();
    expect(await screen.findByRole("status", { name: "Cloning" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocked.projects.retryClone).toHaveBeenCalledWith("p4");
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("switches mode and persists it", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(await screen.findByRole("radio", { name: "Projects" }));
    expect(preferences.getSidebarMode()).toBe("projects");
    expect(await screen.findByRole("group", { name: "Repo" })).toBeInTheDocument();
  });
});

describe("projects mode", () => {
  beforeEach(() => preferences.setSidebarMode("projects"));

  it("orders groups by newest thread and puts empty projects after", async () => {
    mocked.projects.list.mockResolvedValue([
      project(),
      repo,
      project({ id: "p9", name: "Empty", kind: "folder" }),
    ]);
    renderSidebar();
    await screen.findByRole("group", { name: "Repo" });
    const names = screen.getAllByRole("group").map((group) => group.getAttribute("aria-label"));
    expect(names.filter((name) => ["Home", "Repo", "Empty"].includes(name ?? ""))).toEqual([
      "Repo",
      "Home",
      "Empty",
    ]);
  });

  const emptyProject = project({ id: "p9", name: "Empty", kind: "folder" });
  const withEmpty = () => mocked.projects.list.mockResolvedValue([project(), repo, emptyProject]);
  const emptyToggle = (expanded: boolean) => screen.findByRole("button", { name: /^Empty/, expanded });

  it("collapses a busy group and persists the override", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(await screen.findByRole("button", { name: /Repo/, expanded: true }));
    expect(preferences.getProjectOpenOverrides()).toEqual({ p2: false });
    expect(screen.queryByRole("link", { name: /Bravo/ })).not.toBeInTheDocument();
  });

  it("starts collapsed for legacy closed projects", async () => {
    window.localStorage.setItem("tau-sidebar-closed-projects", '["p2"]');
    renderSidebar();
    await screen.findByRole("group", { name: "Repo" });
    expect(screen.queryByRole("link", { name: /Bravo/ })).not.toBeInTheDocument();
  });

  it("collapses a project without threads by default", async () => {
    withEmpty();
    renderSidebar();
    await emptyToggle(false);
    expect(screen.queryByText("No threads yet")).not.toBeInTheDocument();
  });

  it("keeps an empty project open once the user opens it", async () => {
    withEmpty();
    const user = userEvent.setup();
    const view = renderSidebar();
    await user.click(await emptyToggle(false));
    expect(preferences.getProjectOpenOverrides()).toEqual({ p9: true });
    view.unmount();
    renderSidebar();
    await emptyToggle(true);
  });

  it("opens an empty project when its first thread arrives", async () => {
    withEmpty();
    const view = renderSidebar();
    await emptyToggle(false);
    mocked.conversations.listAll.mockResolvedValue([
      conversation({ id: "n", title: "Newest", projectId: "p9", lastActivityAt: 99 }),
    ]);
    await view.client.invalidateQueries();
    await emptyToggle(true);
  });

  it("keeps the project of the current thread open", async () => {
    withEmpty();
    preferences.setProjectOpenOverrides({ p2: false });
    renderSidebar("/p/p2/c/b");
    await screen.findByRole("button", { name: /Repo/, expanded: true });
  });

  it("keeps failed projects reachable with Retry and Remove", async () => {
    mocked.projects.list.mockResolvedValue([
      project(),
      project({ id: "p4", name: "Broken", kind: "git", status: "failed", error: "nope" }),
    ]);
    renderSidebar();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows the path with ~ in the header menu", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(await screen.findByRole("button", { name: "Actions for Repo" }));
    expect(await screen.findByText("~/src/repo")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Change icon" })).toBeInTheDocument();
  });

  it("does not animate group toggles under reduced motion", async () => {
    stubReducedMotion(true);
    const animate = vi.fn();
    Element.prototype.animate = animate;
    const user = userEvent.setup();
    renderSidebar();
    await user.click(await screen.findByRole("button", { name: /Repo/, expanded: true }));
    expect(animate).not.toHaveBeenCalled();
  });
});
