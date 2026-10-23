import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppError, describeExecutors, type RuntimeCapabilities } from "@tau/protocol";
import { createFakeCore, type FakeCore } from "@tau/testkit";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { NodeApiProvider } from "@/nodes/node-context";
import { NewThreadPage } from "./NewThreadPage";

const NATIVE_CAPABILITIES = describeExecutors(undefined).executors[1]?.capabilities as RuntimeCapabilities;

type RuntimesList = FakeCore["runtimes"]["list"];

async function renderPage(runtimes: RuntimesList | undefined) {
  const core = createFakeCore({ configured: true });
  await core.providers.setApiKey("openrouter", "fake");
  if (runtimes) core.runtimes.list = runtimes;
  const api = createApi(createFakeTransport(core));
  const start = vi.spyOn(api.conversations, "start");
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NodeApiProvider api={api}>
          <TooltipProvider>
            <NewThreadPage />
          </TooltipProvider>
        </NodeApiProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByLabelText("Message");
  return { start, user: userEvent.setup() };
}

const enabled: RuntimesList = async () => describeExecutors(NATIVE_CAPABILITIES);

beforeEach(() => window.localStorage.clear());

describe("<NewThreadPage> engine choice", () => {
  it("shows no engine choice when Claude Code is disabled", async () => {
    await renderPage(undefined);
    await screen.findByRole("combobox", { name: "Model" });
    expect(screen.queryByRole("radiogroup", { name: "Engine" })).not.toBeInTheDocument();
  });

  it("shows no engine choice and keeps the composer usable when the node fails", async () => {
    const failing = vi.fn(async () => {
      throw new AppError("internal", "boom");
    });
    const { start, user } = await renderPage(failing);
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(screen.queryByRole("radiogroup", { name: "Engine" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Message"), "hi{Enter}");
    await waitFor(() => expect(start).toHaveBeenCalled());
  });

  it("shows no engine choice for an old node that does not know the route", async () => {
    const old = vi.fn(async () => {
      throw new AppError("not_found", "no such route");
    });
    await renderPage(old);
    await waitFor(() => expect(old).toHaveBeenCalled());
    expect(screen.queryByRole("radiogroup", { name: "Engine" })).not.toBeInTheDocument();
  });

  it("shows the engine choice, Claude Code selected, when Claude Code is installed", async () => {
    await renderPage(enabled);
    const group = await screen.findByRole("radiogroup", { name: "Engine" });
    expect(screen.getByRole("radio", { name: "Claude Code" })).toBeChecked();
    expect(group).toHaveTextContent("Pi");
  });

  it("remembers the engine picked last", async () => {
    const first = await renderPage(enabled);
    await first.user.click(await screen.findByRole("radio", { name: "Pi" }));
    cleanup();
    await renderPage(enabled);
    expect(await screen.findByRole("radio", { name: "Pi" })).toBeChecked();
  });

  it("starts a Pi thread with a request that has no executor key", async () => {
    const { start, user } = await renderPage(enabled);
    await user.click(await screen.findByRole("radio", { name: "Pi" }));
    await user.type(screen.getByLabelText("Message"), "hello{Enter}");
    await waitFor(() => expect(start).toHaveBeenCalled());
    const body = start.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain("executor");
    expect(body).toMatchObject({ projectId: "home", text: "hello" });
    expect(body).toHaveProperty("thinkingLevel");
  });

  it("starts a Claude Code thread with the executor and without model or thinking", async () => {
    const { start, user } = await renderPage(enabled);
    await screen.findByRole("radiogroup", { name: "Engine" });
    await user.type(screen.getByLabelText("Message"), "hello{Enter}");
    await waitFor(() => expect(start).toHaveBeenCalled());
    const body = start.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({ projectId: "home", text: "hello", executor: "claude-code" });
    expect(Object.keys(body)).not.toContain("model");
    expect(Object.keys(body)).not.toContain("thinkingLevel");
  });

  it("hides model, thinking and attachments for Claude Code and says why", async () => {
    const { user } = await renderPage(enabled);
    await screen.findByRole("radiogroup", { name: "Engine" });
    expect(screen.queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Thinking level" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach files" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Attachments are not supported for native threads yet.",
    );
    await user.click(screen.getByRole("radio", { name: "Pi" }));
    expect(await screen.findByRole("combobox", { name: "Model" })).toBeInTheDocument();
  });
});
