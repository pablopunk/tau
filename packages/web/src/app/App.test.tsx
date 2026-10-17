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

async function renderApp({ ready }: { ready: boolean }) {
  vi.stubEnv("VITE_FAKE", "1");
  window.history.replaceState(null, "", ready ? "/?fake=ready" : "/");
  Element.prototype.scrollIntoView = () => {};
  const { App } = await import("./App");
  render(<App />);
  return userEvent.setup();
}

async function openAddProject(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("combobox", { name: "Project" }));
  await user.click(await screen.findByRole("option", { name: /Add project/ }));
}

describe("setup", () => {
  it("takes the key, then the default model, then shows the main screen", async () => {
    const user = await renderApp({ ready: false });

    await user.type(await screen.findByLabelText("OpenRouter API key"), "sk-or-test");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/only affects new conversations/i)).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Default model" }));
    const [firstModel] = await screen.findAllByRole("option");
    await user.click(firstModel as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "New thread" })).toBeInTheDocument();
  });

  it("keeps Continue disabled for an empty key", async () => {
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
    expect(await within(dialog).findByRole("combobox", { name: "Fast model" })).toHaveTextContent(
      "Same as thread",
    );
    expect(within(dialog).getByLabelText("Projects folder")).toBeInTheDocument();
    expect(within(dialog).getByText(/deleting the data home/i)).toBeInTheDocument();
  });

  it("starts a thread from the new thread page with the chosen model", async () => {
    const user = await renderApp({ ready: true });

    expect(await screen.findByRole("combobox", { name: "Project" })).toHaveTextContent("Home");
    expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument();
    await user.type(await screen.findByLabelText("Message"), "hello{Enter}");

    expect(await screen.findByTestId("conversation")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("pi-everywhere:new-thread-request")).toBeNull();
  });
});
