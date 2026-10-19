import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Command, CommandList } from "@/components/ui/command";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { MachineApiProvider } from "@/machines/machine-context";
import { ThreadActions } from "./ThreadActions";

async function renderActions(options: { terminals: boolean }) {
  const core = createFakeCore({ configured: true, terminals: options.terminals });
  await core.providers.setApiKey("openrouter", "fake");
  const { id } = await core.conversations.start({ projectId: "home", text: "hello" } as never);
  const api = createApi(createFakeTransport(core));
  const run = vi.fn((action: () => void) => action);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MachineApiProvider api={api}>
        <MemoryRouter initialEntries={[`/p/home/c/${id}`]}>
          <Command>
            <CommandList>
              <ThreadActions
                projectId="home"
                conversationId={id}
                archived={false}
                onChangeModel={() => {}}
                run={run}
              />
            </CommandList>
          </Command>
          <Where />
        </MemoryRouter>
      </MachineApiProvider>
    </QueryClientProvider>,
  );
  return { id };
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

  it("offers no terminal when this machine cannot run them", async () => {
    await renderActions({ terminals: false });

    await screen.findByRole("option", { name: "Stop agent" });
    expect(screen.queryByRole("option", { name: "New terminal" })).not.toBeInTheDocument();
  });
});
