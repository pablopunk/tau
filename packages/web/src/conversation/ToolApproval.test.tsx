import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { MachineApiProvider } from "@/machines/machine-context";
import { ToolApproval } from "./ToolApproval";

const mocks = vi.hoisted(() => ({ api: null as unknown }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: new Proxy({}, { get: (_, key) => (mocks.api as Record<string, unknown>)[key as string] }),
  };
});

async function renderApproval() {
  const core = createFakeCore({ configured: true });
  mocks.api = createApi(createFakeTransport(core));
  const [project] = await core.projects.list();
  const conversation = await core.conversations.start({
    projectId: project?.id ?? "",
    text: "hi",
    requestId: "r1",
  });
  core.seedApproval(conversation.id, { server: "Linear", tool: "save_comment", arguments: { body: "ok" } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MachineApiProvider>
        <ToolApproval conversationId={conversation.id} />
      </MachineApiProvider>
    </QueryClientProvider>,
  );
  return { core, conversation };
}

describe("ToolApproval", () => {
  it("shows the tool and hides the arguments until opened", async () => {
    const user = userEvent.setup();
    await renderApproval();
    expect(await screen.findByText("Linear · save_comment")).toBeTruthy();
    expect(screen.queryByText(/"body"/)).toBeNull();
    await user.click(screen.getByText("Arguments"));
    expect(screen.getByText(/"body": "ok"/)).toBeTruthy();
  });

  it("always allows the tool and clears the card", async () => {
    const user = userEvent.setup();
    const { core, conversation } = await renderApproval();
    await user.click(await screen.findByRole("button", { name: "Always allow this tool" }));
    await waitFor(async () => expect(await core.approvals.list(conversation.id)).toEqual([]));
    expect((await core.settings.get()).claudeConnectors.alwaysAllow).toEqual([
      "mcp__claude_ai_Linear__save_comment",
    ]);
    await waitFor(() => expect(screen.queryByText("Linear · save_comment")).toBeNull());
  });

  it("denies", async () => {
    const user = userEvent.setup();
    const { core, conversation } = await renderApproval();
    await user.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(async () => expect(await core.approvals.list(conversation.id)).toEqual([]));
  });
});
