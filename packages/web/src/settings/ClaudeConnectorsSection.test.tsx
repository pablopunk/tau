import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { ClaudeConnectorsSection } from "./ClaudeConnectorsSection";

const mocks = vi.hoisted(() => ({ api: null as unknown }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: new Proxy({}, { get: (_, key) => (mocks.api as Record<string, unknown>)[key as string] }),
  };
});

async function renderSection(ready: boolean) {
  const core = createFakeCore({ configured: true });
  mocks.api = createApi(createFakeTransport(core));
  if (ready) await core.providers.acknowledgeClaudeCli();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ClaudeConnectorsSection />
    </QueryClientProvider>,
  );
  return core;
}

describe("ClaudeConnectorsSection", () => {
  it("lists no servers until the Claude CLI is ready", async () => {
    await renderSection(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryAllByRole("switch").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Ask before writes",
    ]);
    expect(screen.queryByText("Connectors show up here once a Claude CLI login is ready.")).toBeTruthy();
  });

  it("lists servers with counts and a needs-auth note without a switch", async () => {
    await renderSection(true);
    expect(await screen.findByText("76 tools · 41 read-only")).toBeTruthy();
    expect(screen.getByText("Needs sign-in (1)")).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.queryByText(/Claude Code/)).toBeNull();
  });

  it("saves the enabled list when a switch flips", async () => {
    const user = userEvent.setup();
    const core = await renderSection(true);
    await user.click(await screen.findByRole("switch", { name: "Linear" }));
    await waitFor(async () =>
      expect((await core.settings.get()).claudeConnectors.enabled).toEqual(["claude.ai Linear"]),
    );
  });

  it("strips the claude.ai prefix and sorts connected servers alphabetically", async () => {
    await renderSection(true);
    await screen.findByText("76 tools · 41 read-only");
    const names = screen.getAllByRole("listitem").map((item) => item.querySelector("span")?.textContent);
    expect(names).toEqual(["Linear", "Slack"]);
    expect(screen.queryByText(/claude\.ai /)).toBeNull();
  });

  it("keeps the needs-sign-in group collapsed until opened", async () => {
    const user = userEvent.setup();
    await renderSection(true);
    expect(screen.queryByText("Connect it on claude.ai")).toBeNull();
    await user.click(await screen.findByText("Needs sign-in (1)"));
    expect(await screen.findByText("Connect it on claude.ai")).toBeTruthy();
  });

  it("starts with Ask before writes off, with its note, and saves it", async () => {
    const user = userEvent.setup();
    const core = await renderSection(true);
    const toggle = await screen.findByRole("switch", { name: "Ask before writes" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("When on, tools that change things ask you first.")).toBeTruthy();
    await user.click(toggle);
    await waitFor(async () =>
      expect((await core.settings.get()).claudeConnectors.askBeforeWrites).toBe(true),
    );
  });
});
