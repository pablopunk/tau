import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConversationView } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Command, CommandList } from "@/components/ui/command";
import { LiveClientProvider } from "@/conversation/live-client-context";
import {
  assistantTextEvent,
  lifecycleEvent,
  nativeView,
  userEvent as userEntry,
} from "@/conversation/native-fixtures";
import { createStubLiveClient, endOf } from "@/conversation/test-utils";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { NodeApiProvider } from "@/nodes/node-context";
import { ThreadActions } from "./ThreadActions";

async function renderActions(options: { terminals: boolean; view?: ConversationView | null }) {
  const core = createFakeCore({ configured: true, terminals: options.terminals });
  await core.providers.setApiKey("openrouter", "fake");
  const { id } = await core.conversations.start({ projectId: "home", text: "hello" } as never);
  const api = createApi(createFakeTransport(core));
  const configure = vi.spyOn(api.conversations, "configure");
  const run = vi.fn((action: () => void) => action);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider api={api}>
        <LiveClientProvider client={createStubLiveClient(options.view ?? null)}>
          <MemoryRouter initialEntries={[`/p/home/c/${id}`]}>
            <Command>
              <CommandList>
                <ThreadActions
                  projectId="home"
                  conversationId={id}
                  archived={false}
                  onChangeModel={() => {}}
                  onChangeThinking={() => {}}
                  run={run}
                />
              </CommandList>
            </Command>
            <Where />
          </MemoryRouter>
        </LiveClientProvider>
      </NodeApiProvider>
    </QueryClientProvider>,
  );
  return { id, configure };
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

describe("thread actions", () => {
  it("opens a terminal and focuses it", async () => {
    const { id } = await renderActions({ terminals: true });

    await userEvent.setup().click(await screen.findByRole("option", { name: "New terminal" }));

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(`/p/home/c/${id}/terminal/terminal-1`),
    );
  });

  it("offers no terminal when this node cannot run them", async () => {
    await renderActions({ terminals: false });

    await screen.findByRole("option", { name: "Stop agent" });
    expect(screen.queryByRole("option", { name: "New terminal" })).not.toBeInTheDocument();
  });

  it("offers the model and thinking actions on a Pi thread", async () => {
    await renderActions({ terminals: false, view: endOf("text") });

    expect(await screen.findByRole("option", { name: "Change model…" })).toBeInTheDocument();
  });

  it("offers neither model nor thinking actions on a native thread, and still stops it", async () => {
    const view = nativeView([
      userEntry("u1", "r1", "work"),
      lifecycleEvent("l1", "running"),
      assistantTextEvent("t1", "on it"),
    ]);
    const { configure } = await renderActions({ terminals: false, view });

    await screen.findByRole("option", { name: "Stop agent" });
    expect(screen.queryByRole("option", { name: "Change model…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Change thinking level…" })).not.toBeInTheDocument();
    expect(configure).not.toHaveBeenCalled();
  });
});
