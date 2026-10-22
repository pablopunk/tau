import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialogProvider } from "@/app/settings-dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { NodeApiProvider } from "@/nodes/node-context";
import { CommandPalette } from "@/palette/CommandPalette";
import { resetPaletteOpen } from "@/palette/palette-open";
import { SECTION_BODIES } from "./section-bodies";
import { SETTINGS_SECTIONS } from "./sections";
import { DYNAMIC_ROW_PREFIXES, SETTINGS_INDEX } from "./settings-index";

const mocks = vi.hoisted(() => ({ api: null as unknown }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: new Proxy({}, { get: (_, key) => (mocks.api as Record<string, unknown>)[key as string] }),
  };
});

function Probe() {
  const location = useLocation();
  return <output data-testid="url">{location.pathname + location.search}</output>;
}

function renderApp(initial: string, extra?: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NodeApiProvider>
        <MemoryRouter initialEntries={[initial]}>
          <TooltipProvider>
            <SettingsDialogProvider>
              <Probe />
              {extra}
            </SettingsDialogProvider>
          </TooltipProvider>
        </MemoryRouter>
      </NodeApiProvider>
    </QueryClientProvider>,
  );
}

const renderedIds = () =>
  [...document.querySelectorAll("[data-setting-id]")].map(
    (el) => el.getAttribute("data-setting-id") as string,
  );

beforeEach(async () => {
  resetPaletteOpen();
  mocks.api = createApi(createFakeTransport(createFakeCore()));
  await (mocks.api as ReturnType<typeof createApi>).mcp.save({
    name: "files",
    transport: "stdio",
    command: "npx",
    args: [],
  } as never);
});

describe("settings index coverage", () => {
  it("has an entry for every rendered row and a row for every entry", async () => {
    const rendered = new Set<string>();
    for (const section of SETTINGS_SECTIONS) {
      const expected = SETTINGS_INDEX.filter((entry) => entry.section === section.id).map((e) => e.id);
      const Body = SECTION_BODIES[section.id];
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const body = render(
        <QueryClientProvider client={client}>
          <NodeApiProvider>
            <MemoryRouter>{Body()}</MemoryRouter>
          </NodeApiProvider>
        </QueryClientProvider>,
      );
      await waitFor(() => {
        for (const id of expected) expect(renderedIds()).toContain(id);
        if (section.id === "providers")
          expect(renderedIds().some((id) => id.startsWith("provider:"))).toBe(true);
        if (section.id === "tools") expect(renderedIds()).toContain("mcp:files");
      });
      const fixed = renderedIds().filter(
        (id) => !DYNAMIC_ROW_PREFIXES.some((prefix) => id.startsWith(prefix)),
      );
      expect(fixed.sort(), section.id).toEqual([...expected].sort());
      for (const id of renderedIds()) rendered.add(id);
      body.unmount();
    }
    expect([...rendered].some((id) => id.startsWith("provider:"))).toBe(true);
    expect(rendered.has("mcp:files")).toBe(true);
    for (const entry of SETTINGS_INDEX) expect(rendered.has(entry.id), entry.id).toBe(true);
  });
});

describe("settings dialog search", () => {
  it("opens from the URL on a section and a setting", async () => {
    renderApp("/?settings=agent&setting=workspace-default");
    const row = await waitFor(() => {
      const found = document.querySelector('[data-setting-id="workspace-default"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await waitFor(() => expect(row).toHaveAttribute("data-highlighted"));
  });

  it("filters, moves with arrows, opens with Enter, and keeps the text out of the URL", async () => {
    const user = userEvent.setup();
    renderApp("/?settings=general");
    const field = await screen.findByPlaceholderText("Search settings");
    await user.type(field, "worktree");
    expect(screen.getByText("New threads use")).toBeInTheDocument();
    expect(screen.getByTestId("url")).not.toHaveTextContent("worktree");

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByTestId("url")).toHaveTextContent("settings=limits&setting=resources-levels-worktree"),
    );
    const row = document.querySelector('[data-setting-id="resources-levels-worktree"]') as HTMLElement;
    await waitFor(() => expect(row).toHaveAttribute("data-highlighted"));
    expect(field).toHaveValue("");
  });

  it("shows an empty state", async () => {
    const user = userEvent.setup();
    renderApp("/?settings=general");
    await user.type(await screen.findByPlaceholderText("Search settings"), "qqqqqq");
    expect(screen.getByText("No settings match “qqqqqq”")).toBeInTheDocument();
  });

  it("clears on Escape first, then closes", async () => {
    const user = userEvent.setup();
    renderApp("/?settings=general");
    const field = await screen.findByPlaceholderText("Search settings");
    await user.type(field, "theme");
    await user.keyboard("{Escape}");
    expect(field).toHaveValue("");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("url")).not.toHaveTextContent("settings=");
  });

  it("focuses the search with / and Ctrl+F", async () => {
    const user = userEvent.setup();
    renderApp("/?settings=general");
    const field = await screen.findByPlaceholderText("Search settings");
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    await user.keyboard("/");
    expect(field).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("{Control>}f{/Control}");
    expect(field).toHaveFocus();
  });
});

describe("palette to setting", () => {
  it("does not say No results when only settings match", async () => {
    const user = userEvent.setup();
    renderApp(
      "/",
      <SidebarProvider>
        <CommandPalette />
      </SidebarProvider>,
    );
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await screen.findByPlaceholderText(/Search threads/), "dark mode");
    expect(await screen.findByRole("option", { name: /Appearance/ })).toBeInTheDocument();
    expect(screen.queryByText("No results.")).not.toBeInTheDocument();
  });

  it("opens the dialog on the chosen setting", async () => {
    const user = userEvent.setup();
    renderApp(
      "/",
      <SidebarProvider>
        <CommandPalette />
      </SidebarProvider>,
    );
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await screen.findByPlaceholderText(/Search threads/), "steer");
    await user.click(await screen.findByRole("option", { name: /While the agent works/ }));

    await waitFor(() =>
      expect(screen.getByTestId("url")).toHaveTextContent("settings=agent&setting=message-mode"),
    );
    const row = await waitFor(() => {
      const found = document.querySelector('[data-setting-id="message-mode"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await waitFor(() => expect(row).toHaveAttribute("data-highlighted"));
  });
});
