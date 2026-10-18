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
  it("shows nothing until the Claude CLI is ready", async () => {
    await renderSection(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Claude connectors")).toBeNull();
  });

  it("lists servers with counts and a needs-auth note without a switch", async () => {
    await renderSection(true);
    expect(await screen.findByText("76 tools · 41 read-only")).toBeTruthy();
    expect(screen.getByText("Connect it on claude.ai")).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.queryByText(/Claude Code/)).toBeNull();
  });

  it("saves the enabled list when a switch flips", async () => {
    const user = userEvent.setup();
    const core = await renderSection(true);
    await user.click(await screen.findByRole("switch", { name: "claude.ai Linear" }));
    await waitFor(async () =>
      expect((await core.settings.get()).claudeConnectors.enabled).toEqual(["claude.ai Linear"]),
    );
  });
});
