import { describeExecutors, emptyHandoffLosses, PI_RUNTIME_CAPABILITIES } from "@tau/protocol";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialogContext } from "@/app/settings-dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { LiveClientProvider } from "@/conversation/live-client-context";
import { createStubLiveClient } from "@/conversation/test-utils";
import { apiOfNode } from "@/nodes/node-apis";
import { conversation, project, renderAt } from "@/sidebar/test-support";
import { CommandPalette } from "./CommandPalette";
import { GlobalShortcuts } from "./GlobalShortcuts";
import { resetPaletteOpen } from "./palette-open";

const api = apiOfNode();

vi.mock("@/lib/api", () => ({
  api: {
    projects: { list: vi.fn() },
    conversations: { listAll: vi.fn(), configure: vi.fn(), handoffPreview: vi.fn() },
    approvals: { list: vi.fn() },
    goals: { get: vi.fn() },
    workspaces: { status: vi.fn() },
    timers: { list: vi.fn() },
    processes: { list: vi.fn() },
    models: { list: vi.fn() },
    runtimes: { list: vi.fn() },
  },
}));

beforeEach(() => {
  resetPaletteOpen();
  vi.resetAllMocks();
  vi.mocked(api.projects.list).mockResolvedValue([
    project(),
    project({ id: "p2", name: "Repo", kind: "folder" }),
  ]);
  vi.mocked(api.models.list).mockResolvedValue([
    {
      provider: "openai",
      providerName: "OpenAI",
      modelId: "gpt-9",
      name: "GPT 9",
      contextWindow: 1,
      images: true,
      thinkingLevels: ["off", "high"],
    } as never,
  ]);
  vi.mocked(api.conversations.configure).mockResolvedValue(undefined);
  vi.mocked(api.runtimes.list).mockResolvedValue(describeExecutors(PI_RUNTIME_CAPABILITIES));
  vi.mocked(api.conversations.handoffPreview).mockResolvedValue({
    canHandoff: true,
    losses: { ...emptyHandoffLosses(), imagesOmitted: 3 },
    preview: "[user]\nfix login",
  });
  vi.mocked(api.approvals.list).mockResolvedValue([]);
  vi.mocked(api.goals.get).mockResolvedValue(null);
  vi.mocked(api.workspaces.status).mockResolvedValue({
    ahead: 0,
    behind: 0,
    dirtyFiles: [],
    unmergedCommits: 0,
    canMerge: true,
    reason: null,
  });
  vi.mocked(api.timers.list).mockResolvedValue([]);
  vi.mocked(api.processes.list).mockResolvedValue([]);
  vi.mocked(api.conversations.listAll).mockResolvedValue([
    conversation({ title: "Fix login bug" }),
    conversation({ id: "c2", projectId: "p2", title: "Add dark mode" }),
  ]);
});

const threadView = {
  entries: [],
  docs: { "pi.agent": { model: { provider: "openai", modelId: "gpt-9" }, thinkingLevel: "off" } },
} as never;

const renderPalette = (path = "/", live = createStubLiveClient(threadView)) =>
  renderAt(
    path,
    <LiveClientProvider client={live}>
      <SidebarProvider>
        <CommandPalette />
      </SidebarProvider>
      <GlobalShortcuts />
    </LiveClientProvider>,
  );

describe("command palette", () => {
  it("opens with Mod+K and filters threads on the client", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("option", { name: /Fix login bug/ });
    await user.type(screen.getByRole("combobox"), "dark");

    expect(screen.getByRole("option", { name: /Add dark mode/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Fix login bug/ })).not.toBeInTheDocument();
  });

  it("navigates to the chosen thread and closes", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: /Add dark mode/ }));

    expect(screen.getByTestId("location")).toHaveTextContent("/p/p2/c/c2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("warms a directly selected local thread before navigating", async () => {
    const target = conversation({ id: "c3", projectId: "p2", title: "Cold target" });
    vi.mocked(api.conversations.listAll).mockResolvedValue([
      conversation({ title: "Fix login bug" }),
      conversation({ id: "c2", projectId: "p2", title: "Add dark mode" }),
      target,
    ]);
    const live = createStubLiveClient(threadView);
    live.warm = vi.fn();
    const user = userEvent.setup();
    renderPalette("/", live);

    await user.keyboard("{Control>}k{/Control}");
    await user.type(screen.getByRole("combobox"), "Cold target");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(live.warm).toHaveBeenCalledWith("c3");
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledWith("c3"));
    expect(screen.getByTestId("location")).toHaveTextContent("/p/p2/c/c3");
  });

  it("starts a new thread in a project from the project entry", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: "Repo" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/new");
  });

  it("asks to open settings on the chosen section", async () => {
    const opened = vi.fn();
    const user = userEvent.setup();
    renderAt(
      "/",
      <SettingsDialogContext.Provider value={opened}>
        <SidebarProvider>
          <CommandPalette />
        </SidebarProvider>
      </SettingsDialogContext.Provider>,
    );

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: "Settings: Providers" }));

    expect(opened).toHaveBeenCalledWith("providers");
  });
});

describe("global shortcuts", () => {
  it("Mod+Shift+O opens a new thread", async () => {
    const user = userEvent.setup();
    renderPalette("/p/p1/c/c1");

    await user.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");

    expect(screen.getByTestId("location")).toHaveTextContent("/new");
  });
});

describe("add project and thread cycling", () => {
  it("opens the add project dialog", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: "Add project" }));

    expect(await screen.findByRole("heading", { name: "Add project" })).toBeInTheDocument();
  });

  it("goes to the next thread", async () => {
    const user = userEvent.setup();
    renderPalette("/p/p2/c/c2");

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: /Next thread/ }));

    expect(screen.getByTestId("location")).toHaveTextContent("/p/p1/c/c1");
  });

  it("Mod+Alt+ArrowDown goes to the next thread", async () => {
    const user = userEvent.setup();
    renderPalette("/p/p2/c/c2");
    await waitFor(() => expect(api.conversations.listAll).toHaveBeenCalled());
    await screen.findByTestId("location");

    await user.keyboard("{Control>}{Alt>}{ArrowDown}{/Alt}{/Control}");

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/p/p1/c/c1"));
  });
});

describe("warming for the thread keys", () => {
  it("has the neighbouring thread ready before Mod+Alt+Arrow is pressed", async () => {
    const live = createStubLiveClient(threadView);
    const warm = vi.fn();
    live.warm = warm;
    renderAt(
      "/p/p2/c/c2",
      <LiveClientProvider client={live}>
        <GlobalShortcuts />
      </LiveClientProvider>,
    );
    await waitFor(() => expect(warm).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledWith("c1"));
    expect(warm).not.toHaveBeenCalledWith("c2");
    expect(api.workspaces.status).toHaveBeenCalledWith("c1", expect.any(Object));
  });
});

describe("models", () => {
  it("changes the model of the open thread from a second page", async () => {
    const user = userEvent.setup();
    renderPalette("/p/p1/c/c1");

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: "Change model…" }));
    await user.click(await screen.findByRole("option", { name: "GPT 9" }));

    expect(api.conversations.configure).toHaveBeenCalledWith("c1", {
      model: { provider: "openai", modelId: "gpt-9" },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("marks the thread's current model", async () => {
    const user = userEvent.setup();
    renderPalette("/p/p1/c/c1");

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: "Change model…" }));

    expect(await screen.findByRole("option", { name: "GPT 9" })).toHaveAttribute("data-checked", "true");
  });

  it("changes the thinking level of the open thread", async () => {
    const user = userEvent.setup();
    renderPalette("/p/p1/c/c1");

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: "Change thinking level…" }));
    expect(await screen.findByRole("option", { name: "off" })).toHaveAttribute("data-checked", "true");
    await user.click(screen.getByRole("option", { name: "high" }));

    expect(api.conversations.configure).toHaveBeenCalledWith("c1", { thinkingLevel: "high" });
  });

  it("Backspace on an empty search goes back to the actions", async () => {
    const user = userEvent.setup();
    renderPalette("/p/p1/c/c1");

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: "Change model…" }));
    await screen.findByRole("option", { name: "GPT 9" });
    await user.keyboard("{Backspace}");

    expect(await screen.findByRole("option", { name: "New thread" })).toBeInTheDocument();
  });

  it("does not list models as settings results", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("option", { name: /Fix login bug/ });
    await user.type(screen.getByRole("combobox"), "gpt");

    expect(screen.queryByRole("option", { name: /GPT 9/ })).not.toBeInTheDocument();
  });
});

describe("continue in Claude Code", () => {
  it("asks the node for its runtimes only once the palette opens", async () => {
    const user = userEvent.setup();
    renderPalette("/p/p1/c/c1");
    await waitFor(() => expect(api.conversations.listAll).toHaveBeenCalled());

    expect(api.runtimes.list).not.toHaveBeenCalled();
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("option", { name: "Continue in Claude Code…" });

    expect(api.runtimes.list).toHaveBeenCalledTimes(1);
  });

  it("opens the handoff dialog from the action", async () => {
    const user = userEvent.setup();
    renderPalette("/p/p1/c/c1");

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: "Continue in Claude Code…" }));

    expect(await screen.findByRole("heading", { name: "Continue in Claude Code" })).toBeInTheDocument();
    expect(await screen.findByText("3 images omitted")).toBeInTheDocument();
    expect(api.conversations.handoffPreview).toHaveBeenCalledWith("c1");
  });

  it("is not offered while the node has Claude Code off", async () => {
    vi.mocked(api.runtimes.list).mockResolvedValue(describeExecutors(undefined));
    const user = userEvent.setup();
    renderPalette("/p/p1/c/c1");

    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("option", { name: "Change model…" });
    await waitFor(() => expect(api.runtimes.list).toHaveBeenCalled());

    expect(screen.queryByRole("option", { name: "Continue in Claude Code…" })).not.toBeInTheDocument();
  });
});
