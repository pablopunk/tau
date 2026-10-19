import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preferences } from "../lib/preferences";

beforeEach(() => preferences.setSidebarMode("projects"));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

async function loadFakeTransportBeforeRendering() {
  await import("../lib/transport/fake");
}

async function renderApp({ ready, connected = false }: { ready: boolean; connected?: boolean }) {
  vi.stubEnv("VITE_FAKE", "1");
  window.history.replaceState(null, "", ready ? "/?fake=ready" : "/");
  Element.prototype.scrollIntoView = () => {};
  const { App } = await import("./App");
  await loadFakeTransportBeforeRendering();
  if (connected) {
    const { api } = await import("../lib/api");
    await api.providers.setKey("openrouter", "sk-or-existing");
  }
  render(<App />);
  return userEvent.setup();
}

async function openAddProject(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("combobox", { name: "Project" }));
  await user.click(await screen.findByRole("button", { name: /Add project/ }));
}

describe("setup", () => {
  // About 1 s alone; the whole setup flow took over 20 s twice with load at 50-70 from other threads.
  it("takes the key, then the default model, then shows the main screen", async () => {
    const user = await renderApp({ ready: false });

    const row = within(await screen.findByRole("listitem", { name: "OpenRouter" }));
    await user.click(row.getByRole("button", { name: "Add key for OpenRouter" }));
    await user.type(row.getByLabelText("OpenRouter API key"), "sk-or-test");
    await user.click(row.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/only affects new conversations/i)).toBeInTheDocument();
    const folder = screen.getByRole("combobox", { name: "Projects folder" });
    await user.clear(folder);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(folder, "/Users/demo/workspace");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const { api } = await import("../lib/api");
    await waitFor(async () =>
      expect((await api.settings.get()).projectsFolder).toBe("/Users/demo/workspace"),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /as your code folder/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Default model" }));
    const [firstModel] = await screen.findAllByRole("option");
    await user.click(firstModel as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "New thread" })).toBeInTheDocument();
  }, 60_000);

  it("shows detected providers before models and lets the user go back", async () => {
    const user = await renderApp({ ready: false, connected: true });
    expect(await screen.findByText("Step 1 of 2. Review your providers.")).toBeInTheDocument();
    expect(await screen.findByRole("listitem", { name: "OpenRouter" })).toBeInTheDocument();
    expect(await screen.findByText(/You’re connected/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Default model" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("combobox", { name: "Default model" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to providers" }));
    expect(await screen.findByText("Step 1 of 2. Review your providers.")).toBeInTheDocument();
  });

  it("keeps Continue disabled until a provider is connected", async () => {
    await renderApp({ ready: false });
    expect(await screen.findByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("main screen", () => {
  it("shows the project, an empty state, and starts a thread from the plus button", async () => {
    const user = await renderApp({ ready: true });

    expect(await screen.findByRole("heading", { name: "New thread" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "New thread in project" }));
    expect(window.location.pathname + window.location.search).toMatch(/^\/new\?project=/);
    await user.type(await screen.findByLabelText("Message"), "hello{Enter}");

    expect(await screen.findByTestId("conversation")).toBeInTheDocument();
    expect(window.location.pathname).toMatch(/^\/p\/[^/]+\/c\/[^/]+$/);
    const group = screen.getByRole("group", { name: "project" });
    expect(await within(group).findByRole("link")).toHaveAttribute("aria-current", "page");
  });

  it("shows the API error inline when the folder does not exist", async () => {
    const user = await renderApp({ ready: true });

    await openAddProject(user);
    await user.type(screen.getByLabelText("Folder path"), "/nope");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No such folder: /nope");
  });

  it("adds a project with a custom name", async () => {
    const user = await renderApp({ ready: true });

    await openAddProject(user);
    await user.type(screen.getByLabelText("Folder path"), "/Users/demo/other");
    await user.type(screen.getByLabelText(/Name/), "Side quest");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add project" }));

    expect(await screen.findByRole("group", { name: "Side quest" })).toBeInTheDocument();
  });

  it("renames and removes a project", async () => {
    const user = await renderApp({ ready: true });

    await user.click(await screen.findByRole("button", { name: "Actions for project" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename project" }));
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("group", { name: "Renamed" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for Renamed" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove project" }));
    await user.click(screen.getByRole("button", { name: "Remove project" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Renamed" })).not.toBeInTheDocument());
  });

  it("renames a conversation", async () => {
    const user = await renderApp({ ready: true });

    await user.click(await screen.findByRole("button", { name: "New thread in project" }));
    await user.type(await screen.findByLabelText("Message"), "hello{Enter}");
    const group = await screen.findByRole("group", { name: "project" });
    const link = await within(group).findByRole("link");
    await user.click(within(group).getByRole("button", { name: /^Actions for hello/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename thread" }));
    const input = screen.getByLabelText("Title");
    await user.clear(input);
    await user.type(input, "Fix the build");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(link).toHaveTextContent("Fix the build"));
  });

  it("opens settings with the model, fast model and projects folder fields", async () => {
    const user = await renderApp({ ready: true });

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "This node" }));
    await user.click(within(dialog).getByRole("button", { name: "Models" }));
    expect(await within(dialog).findByRole("combobox", { name: "Fast model" })).toHaveTextContent(
      "Same as thread",
    );
    await user.click(within(dialog).getByRole("button", { name: "Projects" }));
    expect(await within(dialog).findByLabelText("Projects folder")).toBeInTheDocument();
    expect(within(dialog).getByText(/deleting the data home/i)).toBeInTheDocument();
  });

  it("lists the providers and their connection in the providers section", async () => {
    const user = await renderApp({ ready: true });

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "This node" }));
    await user.click(within(dialog).getByRole("button", { name: "Providers" }));

    expect(await within(dialog).findByText("OpenRouter")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Uses an API key.").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByRole("img", { name: "Connected" }).length).toBeGreaterThan(0);
  });

  it("starts a thread from the new thread page with the chosen model", async () => {
    const user = await renderApp({ ready: true });

    expect(await screen.findByRole("combobox", { name: "Project" })).toHaveTextContent("Home");
    expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument();
    await user.type(await screen.findByLabelText("Message"), "hello{Enter}");

    expect(await screen.findByTestId("conversation")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("tau:new-thread-request")).toBeNull();
  });
});
