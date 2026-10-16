import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
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

describe("setup", () => {
  it("takes the key, then the default model, then shows the main screen", async () => {
    const user = await renderApp({ ready: false });

    await user.type(await screen.findByLabelText("OpenRouter API key"), "sk-or-test");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/only affects new conversations/i)).toBeInTheDocument();
    await user.click(screen.getByRole("combobox"));
    const [firstModel] = await screen.findAllByRole("option");
    await user.click(firstModel as HTMLElement);

    expect(await screen.findByText("No chat selected")).toBeInTheDocument();
  });

  it("keeps Continue disabled for an empty key", async () => {
    await renderApp({ ready: false });
    expect(await screen.findByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("main screen", () => {
  it("shows the project, an empty state, and starts a chat from the plus button", async () => {
    const user = await renderApp({ ready: true });

    expect(await screen.findByText("No chat selected")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "New chat in project" }));

    expect(await screen.findByTestId("conversation")).toBeInTheDocument();
    expect(window.location.pathname).toMatch(/^\/p\/[^/]+\/c\/[^/]+$/);
    const group = screen.getByRole("group", { name: "project" });
    expect(await within(group).findByRole("link")).toHaveAttribute("aria-current", "page");
  });

  it("shows the API error inline when the folder does not exist", async () => {
    const user = await renderApp({ ready: true });

    await user.click(await screen.findByRole("button", { name: "Add project" }));
    await user.type(screen.getByLabelText("Folder path"), "/nope");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No such folder: /nope");
  });

  it("adds a project with a custom name", async () => {
    const user = await renderApp({ ready: true });

    await user.click(await screen.findByRole("button", { name: "Add project" }));
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
    expect(screen.getByText("Add a project to start chatting.")).toBeInTheDocument();
  });

  it("renames a conversation", async () => {
    const user = await renderApp({ ready: true });

    await user.click(await screen.findByRole("button", { name: "New chat in project" }));
    const group = await screen.findByRole("group", { name: "project" });
    const link = await within(group).findByRole("link");
    await user.click(within(group).getByRole("button", { name: /^Actions for New chat/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename chat" }));
    const input = screen.getByLabelText("Title");
    await user.clear(input);
    await user.type(input, "Fix the build");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(link).toHaveTextContent("Fix the build"));
  });

  it("opens settings with the default-model note", async () => {
    const user = await renderApp({ ready: true });

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByText(/only affects new conversations/i)).toBeInTheDocument();
  });
});
