import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore } from "@tau/testkit";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { NodeApiProvider } from "@/nodes/node-context";
import { ToolApproval } from "./ToolApproval";

const mocks = vi.hoisted(() => ({ api: null as unknown, toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: mocks.toastError } }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: new Proxy({}, { get: (_, key) => (mocks.api as Record<string, unknown>)[key as string] }),
  };
});

type Seed = { server: string; tool: string; arguments: Record<string, unknown> };

async function renderApproval(
  seed: Seed = { server: "Linear", tool: "save_comment", arguments: { body: "ok" } },
) {
  const core = createFakeCore({ configured: true });
  mocks.api = createApi(createFakeTransport(core));
  const [project] = await core.projects.list();
  const conversation = await core.conversations.start({
    projectId: project?.id ?? "",
    text: "hi",
    requestId: "r1",
  });
  core.seedApproval(conversation.id, seed);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NodeApiProvider>
        <ToolApproval conversationId={conversation.id} />
      </NodeApiProvider>
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

  it("offers no always-allow for a native Claude tool", async () => {
    await renderApproval({ server: "Claude Code", tool: "Bash", arguments: { command: "ls" } });
    expect(await screen.findByRole("button", { name: "Allow once" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Always allow this tool" })).toBeNull();
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
  });

  it("denies", async () => {
    const user = userEvent.setup();
    const { core, conversation } = await renderApproval();
    await user.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(async () => expect(await core.approvals.list(conversation.id)).toEqual([]));
  });

  it("removes the card at the tap, before the server answers", async () => {
    const user = userEvent.setup();
    await renderApproval();
    const api = mocks.api as ReturnType<typeof createApi>;
    const decide = vi.spyOn(api.approvals, "decide").mockReturnValue(new Promise(() => {}));
    await user.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(screen.queryByLabelText("Tool approval")).toBeNull());
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("puts the card back and says why when the decision fails", async () => {
    const user = userEvent.setup();
    await renderApproval();
    const api = mocks.api as ReturnType<typeof createApi>;
    let fail: (error: Error) => void = () => {};
    vi.spyOn(api.approvals, "decide").mockReturnValue(new Promise((_, reject) => (fail = reject)));
    await user.click(await screen.findByRole("button", { name: "Allow once" }));
    await waitFor(() => expect(screen.queryByLabelText("Tool approval")).toBeNull());
    await act(async () => fail(new Error("Server unreachable")));
    expect(await screen.findByLabelText("Tool approval")).toBeTruthy();
    expect(mocks.toastError).toHaveBeenCalledWith("Server unreachable");
  });
});
