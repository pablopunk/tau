import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Backend, createBackend, renderPanes, startThread } from "./test-harness";

const state = vi.hoisted(() => ({
  backend: undefined as unknown as { transport: unknown },
  xtermLoads: 0,
  writes: [] as string[],
}));

vi.mock("@/lib/api", async () => {
  const { createApi } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    get api() {
      return createApi(state.backend.transport as never);
    },
  };
});
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    proposeDimensions = () => ({ cols: 100, rows: 30 });
    fit = () => {};
    activate() {}
    dispose() {}
  },
}));
vi.mock("@xterm/xterm", () => {
  state.xtermLoads += 1;
  return {
    Terminal: class {
      cols = 100;
      rows = 30;
      options = {};
      loadAddon(addon: { activate: () => void }) {
        addon.activate();
      }
      open() {}
      onData() {}
      onBinary() {}
      attachCustomKeyEventHandler() {}
      write(data: Uint8Array) {
        state.writes.push(new TextDecoder().decode(data));
      }
      reset() {
        state.writes.push("<reset>");
      }
      focus() {}
      dispose() {}
    },
  };
});

let backend: Backend;
let conversationId: string;
const threadPath = () => `/p/home/c/${conversationId}`;

async function setup(options: { terminals?: boolean } = {}) {
  backend = createBackend(options);
  state.backend = backend;
  conversationId = await startThread(backend.core);
}

beforeEach(() => {
  state.writes.length = 0;
  window.localStorage.clear();
  window.innerWidth = 1200;
});
afterEach(() => {
  window.innerWidth = 1024;
});

const where = () => screen.getByTestId("where").textContent;

// First in the file: the xterm mock factory runs once, on the first import.
describe("lazy xterm", () => {
  it("is not loaded on a thread view, and loads with the first terminal", async () => {
    await setup();
    renderPanes(threadPath());
    await screen.findByTestId("conversation");
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(state.xtermLoads).toBe(0);
    await userEvent.click(await screen.findByRole("button", { name: /Terminal/ }));
    await waitFor(() => expect(state.xtermLoads).toBeGreaterThan(0));
  });
});

describe("terminal button", () => {
  it("is hidden when terminals are not available", async () => {
    await setup({ terminals: false });
    renderPanes(threadPath());
    await screen.findByTestId("conversation");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("button", { name: /Terminal/ })).toBeNull();
  });

  it("opens a terminal and focuses it through the URL", async () => {
    await setup();
    renderPanes(threadPath());
    await userEvent.click(await screen.findByRole("button", { name: /Terminal/ }));
    await waitFor(() => expect(where()).toBe(`${threadPath()}/terminal/terminal-1`));
    expect(await screen.findByRole("tab", { name: "sh" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Terminal" })).toBeInTheDocument();
    await waitFor(() => expect(state.writes.join("")).toContain("$ "));
  });
});

describe("strip layout", () => {
  it("is side by side on desktop with a splitter, and keeps the conversation mounted", async () => {
    await setup();
    const { id } = await backend.core.terminals.open(conversationId, { cols: 80, rows: 24 });
    renderPanes(threadPath());
    const conversation = await screen.findByTestId("conversation");
    const composer = screen.getByRole("textbox", { name: "Message" });
    expect(await screen.findByRole("separator", { name: "Resize panes" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Chat" })).toBeNull();
    expect(screen.getByTestId("conversation")).toBe(conversation);
    expect(screen.getByRole("textbox", { name: "Message" })).toBe(composer);
    expect(within(screen.getByTestId("conversation")).getByTestId("scroll")).toHaveClass("overflow-y-auto");
    expect(id).toBe("terminal-1");
  });

  it("stores the split per browser", async () => {
    await setup();
    await backend.core.terminals.open(conversationId, { cols: 80, rows: 24 });
    renderPanes(threadPath());
    const separator = await screen.findByRole("separator", { name: "Resize panes" });
    separator.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(window.localStorage.getItem("tau:pane-split")).toBe("48");
  });

  it("is tabs below 760 px, one visible", async () => {
    window.innerWidth = 500;
    await setup();
    await backend.core.terminals.open(conversationId, { cols: 80, rows: 24 });
    renderPanes(`${threadPath()}/terminal/terminal-1`);
    expect(await screen.findByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Terminal 1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("conversation").parentElement).toHaveAttribute("hidden");
    expect(screen.queryByRole("separator")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Chat" }));
    await waitFor(() => expect(where()).toBe(threadPath()));
    expect(screen.getByTestId("conversation").parentElement).not.toHaveAttribute("hidden");
    expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();
  });
});

describe("routes and ended state", () => {
  it("restores the focused pane from the URL", async () => {
    await setup();
    await backend.core.terminals.open(conversationId, { cols: 80, rows: 24 });
    await backend.core.terminals.open(conversationId, { cols: 80, rows: 24 });
    renderPanes(`${threadPath()}/terminal/terminal-2`);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    await userEvent.click(tabs[0] as HTMLElement);
    await waitFor(() => expect(where()).toBe(`${threadPath()}/terminal/terminal-1`));
  });

  it("keeps an ended tab with the message for a non-zero exit", async () => {
    await setup();
    const { id } = await backend.core.terminals.open(conversationId, { cols: 80, rows: 24 });
    const shell = await backend.core.terminals.attach(id, { onData: () => {}, onExit: () => {} });
    shell.write(new TextEncoder().encode("exit 3\r"));
    shell.detach();
    renderPanes(`${threadPath()}/terminal/${id}`);
    await waitFor(() => expect(screen.getByText(/This terminal ended \(exit code 3\)/)).toBeInTheDocument());
    expect(await screen.findByRole("tab", { name: /sh/ })).toHaveAttribute("data-ended", "true");
  });

  it("a clean exit removes the tab and goes back to the thread without an ended notice", async () => {
    await setup();
    const { id } = await backend.core.terminals.open(conversationId, { cols: 80, rows: 24 });
    renderPanes(`${threadPath()}/terminal/${id}`, backend.core);
    await screen.findByRole("tab", { name: /sh/ });
    const shell = await backend.core.terminals.attach(id, { onData: () => {}, onExit: () => {} });
    shell.write(new TextEncoder().encode("exit\r"));
    await waitFor(() => expect(where()).toBe(threadPath()));
    expect(screen.queryByText(/This terminal ended/)).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("an unknown terminal id goes back to the thread", async () => {
    await setup();
    await backend.core.terminals.open(conversationId, { cols: 80, rows: 24 });
    renderPanes(`${threadPath()}/terminal/nope`);
    await waitFor(() => expect(where()).not.toContain("nope"));
  });

  it("closing the focused tab goes back to the conversation", async () => {
    await setup();
    await backend.core.terminals.open(conversationId, { cols: 80, rows: 24 });
    renderPanes(`${threadPath()}/terminal/terminal-1`);
    await userEvent.click(await screen.findByRole("button", { name: "Close sh" }));
    await waitFor(() => expect(where()).toBe(threadPath()));
  });
});
