import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialogContext } from "@/app/settings-dialog";
import { api } from "@/lib/api";
import { conversation, project, renderAt } from "@/sidebar/test-support";
import { CommandPalette } from "./CommandPalette";
import { GlobalShortcuts } from "./GlobalShortcuts";

vi.mock("@/lib/api", () => ({
  api: { projects: { list: vi.fn() }, conversations: { listAll: vi.fn() } },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.projects.list).mockResolvedValue([
    project(),
    project({ id: "p2", name: "Repo", kind: "folder" }),
  ]);
  vi.mocked(api.conversations.listAll).mockResolvedValue([
    conversation({ title: "Fix login bug" }),
    conversation({ id: "c2", projectId: "p2", title: "Add dark mode" }),
  ]);
});

const renderPalette = (path = "/") =>
  renderAt(
    path,
    <>
      <CommandPalette />
      <GlobalShortcuts />
    </>,
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

  it("asks to open settings from the Settings action", async () => {
    const opened = vi.fn();
    const user = userEvent.setup();
    renderAt(
      "/",
      <SettingsDialogContext.Provider value={opened}>
        <CommandPalette />
      </SettingsDialogContext.Provider>,
    );

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: "Settings" }));

    expect(opened).toHaveBeenCalledTimes(1);
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
