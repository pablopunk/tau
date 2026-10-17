import type { GithubRepo, GithubStatus, Project } from "@pi-everywhere/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPicker } from "@/routes/ProjectPicker";
import { CodeFolderSuggestion } from "./CodeFolderSuggestion";
import { GithubSettingsRow } from "./GithubSettingsRow";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  repos: vi.fn(),
  refreshRepos: vi.fn(),
  use: vi.fn(),
  suggested: vi.fn(),
  settings: vi.fn(),
  setProjectsFolder: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    github: { status: mocks.status, repos: mocks.repos, refreshRepos: mocks.refreshRepos, use: mocks.use },
    settings: {
      suggestedCodeFolder: mocks.suggested,
      get: mocks.settings,
      setProjectsFolder: mocks.setProjectsFolder,
    },
    projects: { list: async () => [] },
  },
}));

const connected: GithubStatus = {
  state: "connected",
  login: "pablo",
  gitProtocol: "https",
  tokenSource: "keyring",
};

const repo = (nameWithOwner: string, extra: Partial<GithubRepo> = {}): GithubRepo => ({
  nameWithOwner,
  description: null,
  private: false,
  pushedAt: Date.now() - 3 * 86_400_000,
  localPath: null,
  projectId: null,
  ...extra,
});

const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id,
  name: id,
  path: `/src/${id}`,
  createdAt: 0,
  kind: "git",
  status: "ready",
  isGitRepo: true,
  ...extra,
});

const home = project("home", { kind: "home" });

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.status.mockResolvedValue(connected);
  mocks.repos.mockResolvedValue([
    repo("me/local", { localPath: "/src/local", private: true }),
    repo("me/remote"),
  ]);
});

async function openPicker(onProject = vi.fn()) {
  const user = userEvent.setup();
  wrap(<ProjectPicker projects={[home]} projectId="home" onProject={onProject} disabled={false} />);
  await user.click(screen.getByRole("combobox", { name: "Project" }));
  await screen.findByText("me/remote");
  return { user, onProject };
}

describe("project picker on GitHub", () => {
  it("lists Projects then On GitHub with local, private and refresh", async () => {
    await openPicker();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("On GitHub")).toBeInTheDocument();
    expect(screen.getByText(/^local/)).toBeInTheDocument();
    expect(screen.getByLabelText("Private")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh GitHub repos" })).toBeInTheDocument();
  });

  it("uses a repo with a local copy and selects the project", async () => {
    mocks.use.mockResolvedValue(project("p1"));
    const { user, onProject } = await openPicker();
    await user.click(screen.getByText("me/local"));
    expect(mocks.use).toHaveBeenCalledWith({ nameWithOwner: "me/local", mode: "local" });
    await vi.waitFor(() => expect(onProject).toHaveBeenCalledWith("p1"));
  });

  it("clones a repo without a copy and shows the claimed folder", async () => {
    mocks.use.mockResolvedValue(project("p2", { status: "cloning", path: "/src/remote-2" }));
    const { user, onProject } = await openPicker();
    await user.click(screen.getByText("me/remote"));
    await user.click(await screen.findByRole("button", { name: "Clone now" }));
    expect(mocks.use).toHaveBeenCalledWith({ nameWithOwner: "me/remote", mode: "clone" });
    expect(await screen.findByText("Cloning into /src/remote-2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(onProject).toHaveBeenCalledWith("p2"));
  });

  it("uses an existing folder", async () => {
    mocks.use.mockResolvedValue(project("p3"));
    const { user, onProject } = await openPicker();
    await user.click(screen.getByText("me/remote"));
    await user.click(await screen.findByRole("button", { name: "Use an existing folder" }));
    await user.type(screen.getByLabelText("Folder path"), "/work/remote");
    await user.click(screen.getByRole("button", { name: "Use folder" }));
    expect(mocks.use).toHaveBeenCalledWith({
      nameWithOwner: "me/remote",
      mode: "folder",
      path: "/work/remote",
    });
    await vi.waitFor(() => expect(onProject).toHaveBeenCalledWith("p3"));
  });

  it("shows the hint when GitHub is not available", async () => {
    mocks.status.mockResolvedValue({ state: "not_logged_in", hint: "Run gh auth login." });
    const user = userEvent.setup();
    wrap(<ProjectPicker projects={[home]} projectId="home" onProject={vi.fn()} disabled={false} />);
    await user.click(screen.getByRole("combobox", { name: "Project" }));
    expect(await screen.findByText("Run gh auth login.")).toBeInTheDocument();
  });
});

describe("settings", () => {
  it.each([
    [connected, /Connected as pablo\. Token from keyring/],
    [{ state: "not_installed" } as GithubStatus, /Install the GitHub CLI/],
    [{ state: "not_logged_in", hint: "Run gh auth login." } as GithubStatus, /Run gh auth login/],
    [{ state: "error", message: "gh timed out" } as GithubStatus, /gh timed out/],
  ])("shows the GitHub row for %o", async (status, text) => {
    mocks.status.mockResolvedValue(status);
    wrap(<GithubSettingsRow />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("suggests the code folder and saves it", async () => {
    mocks.suggested.mockResolvedValue({ path: "/Users/me/src" });
    mocks.settings.mockResolvedValue({
      defaultModel: null,
      fastModel: null,
      projectsFolder: "/data/projects",
    });
    mocks.setProjectsFolder.mockResolvedValue(undefined);
    wrap(<CodeFolderSuggestion />);
    await userEvent.click(await screen.findByRole("button", { name: "Use ~/src as your code folder" }));
    expect(mocks.setProjectsFolder).toHaveBeenCalledWith("/Users/me/src");
  });

  it("hides the suggestion when there is none", async () => {
    mocks.suggested.mockResolvedValue(null);
    mocks.settings.mockResolvedValue({
      defaultModel: null,
      defaultThinkingLevel: null,
      fastModel: null,
      fastThinkingLevel: null,
      projectsFolder: "",
    });
    wrap(<CodeFolderSuggestion />);
    await vi.waitFor(() => expect(mocks.suggested).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });
});
