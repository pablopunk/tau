import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialogContext } from "@/app/settings-dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { LiveClientProvider } from "@/conversation/live-client-context";
import { createStubLiveClient } from "@/conversation/test-utils";
import { apiOfMachine } from "@/machines/machine-apis";
import { conversation, project, renderAt } from "@/sidebar/test-support";
import { CommandPalette } from "./CommandPalette";
import { GlobalShortcuts } from "./GlobalShortcuts";

const api = apiOfMachine();

vi.mock("@/lib/api", () => ({
  api: {
    projects: { list: vi.fn() },
    conversations: { listAll: vi.fn(), configure: vi.fn() },
    models: { list: vi.fn() },
  },
}));

beforeEach(() => {
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
  vi.mocked(api.conversations.listAll).mockResolvedValue([
    conversation({ title: "Fix login bug" }),
    conversation({ id: "c2", projectId: "p2", title: "Add dark mode" }),
  ]);
});

const threadView = {
  entries: [],
  docs: { "pi.agent": { model: { provider: "openai", modelId: "gpt-9" }, thinkingLevel: "off" } },
} as never;

const renderPalette = (path = "/") =>
  renderAt(
    path,
    <LiveClientProvider client={createStubLiveClient(threadView)}>
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
