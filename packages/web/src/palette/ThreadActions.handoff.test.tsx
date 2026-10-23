import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore } from "@tau/testkit";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Command, CommandList } from "@/components/ui/command";
import { LiveClientProvider } from "@/conversation/live-client-context";
import { createStubLiveClient } from "@/conversation/test-utils";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { installFakeNative } from "@/lib/transport/fake-native";
import { NodeApiProvider } from "@/nodes/node-context";
import { ThreadActions } from "./ThreadActions";

const HANDOFF_ITEM = { name: "Continue in Claude Code…" };

interface Options {
  native?: boolean;
  nativeThread?: boolean;
  archived?: boolean;
  runtimesFail?: boolean;
}

async function renderActions({
  native = true,
  nativeThread = false,
  archived = false,
  runtimesFail = false,
}: Options) {
  const core = createFakeCore({ configured: true });
  await core.providers.setApiKey("openrouter", "fake");
  if (native) installFakeNative(core);
  const started = await core.conversations.start({
    projectId: "home",
    text: "hello",
    requestId: "r0",
    ...(nativeThread ? { executor: "claude-code" } : {}),
  } as never);
  const api = createApi(createFakeTransport(core));
  const runtimes = vi.spyOn(api.runtimes, "list");
  const listAll = vi.spyOn(api.conversations, "listAll");
  if (runtimesFail) runtimes.mockRejectedValue(new Error("old node"));
  const onHandoff = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider api={api}>
        <LiveClientProvider client={createStubLiveClient(null)}>
          <MemoryRouter>
            <Command>
              <CommandList>
                <ThreadActions
                  projectId="home"
                  conversationId={started.id}
                  archived={archived}
                  onChangeModel={() => {}}
                  onChangeThinking={() => {}}
                  onHandoff={onHandoff}
                  run={(action) => action}
                />
              </CommandList>
            </Command>
          </MemoryRouter>
        </LiveClientProvider>
      </NodeApiProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: "Stop agent" });
  await act(async () => void (await listAll.mock.results[0]?.value));
  return { runtimes, onHandoff };
}

describe("thread actions: continue in Claude Code", () => {
  it("is offered on a Pi thread when the node enables Claude Code, and starts the handoff", async () => {
    const { onHandoff } = await renderActions({});

    await userEvent.setup().click(await screen.findByRole("option", HANDOFF_ITEM));

    expect(onHandoff).toHaveBeenCalledOnce();
  });

  it("is hidden when the node has Claude Code disabled", async () => {
    const { runtimes } = await renderActions({ native: false });

    await waitFor(() => expect(runtimes).toHaveBeenCalled());
    expect(screen.queryByRole("option", HANDOFF_ITEM)).not.toBeInTheDocument();
  });

  it("is hidden when the runtimes request fails, without an error", async () => {
    const { runtimes } = await renderActions({ runtimesFail: true });

    await waitFor(() => expect(runtimes).toHaveBeenCalled());
    expect(screen.queryByRole("option", HANDOFF_ITEM)).not.toBeInTheDocument();
  });

  it("is hidden on a native thread, which never asks for the runtimes", async () => {
    const { runtimes } = await renderActions({ nativeThread: true });

    await waitFor(() => expect(screen.queryByRole("option", { name: "Change model…" })).toBeNull());
    expect(screen.queryByRole("option", HANDOFF_ITEM)).not.toBeInTheDocument();
    expect(runtimes).not.toHaveBeenCalled();
  });

  it("is hidden on an archived thread and does not ask for the runtimes", async () => {
    const { runtimes } = await renderActions({ archived: true });

    expect(screen.queryByRole("option", HANDOFF_ITEM)).not.toBeInTheDocument();
    expect(runtimes).not.toHaveBeenCalled();
  });
});
