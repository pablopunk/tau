import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppError, emptyHandoffLosses, type HandoffPreview } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { type Api, createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { installFakeNative } from "@/lib/transport/fake-native";
import { NodeApiProvider } from "@/nodes/node-context";
import { HandoffDialog } from "./HandoffDialog";

const READY_PREVIEW: HandoffPreview = {
  canHandoff: true,
  losses: {
    ...emptyHandoffLosses(),
    imagesOmitted: 3,
    thinkingBlocksOmitted: 12,
    toolResultsTruncated: 2,
    compactionPresent: true,
  },
  preview: "[user]\nfix the settings page",
};

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

async function renderDialog(setup: (api: Api) => void = () => {}) {
  const core = createFakeCore({ configured: true });
  await core.providers.setApiKey("openrouter", "fake");
  installFakeNative(core);
  const { id } = await core.conversations.start({
    projectId: "home",
    text: "hello",
    requestId: "r0",
  } as never);
  const api = createApi(createFakeTransport(core));
  setup(api);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider api={api}>
        <MemoryRouter initialEntries={[`/p/home/c/${id}`]}>
          <HandoffDialog conversationId={id} onClose={onClose} />
          <Where />
        </MemoryRouter>
      </NodeApiProvider>
    </QueryClientProvider>,
  );
  return { id, api, onClose };
}

const confirmButton = () => screen.findByRole("button", { name: "Create thread" });

describe("handoff dialog", () => {
  it("shows the preview, the losses and that the thread is not changed", async () => {
    await renderDialog((api) =>
      vi.spyOn(api.conversations, "handoffPreview").mockResolvedValue(READY_PREVIEW),
    );

    expect(await screen.findByText(/fix the settings page/)).toBeInTheDocument();
    expect(screen.getByText("Creates a new thread. This thread is not changed.")).toBeInTheDocument();
    expect(screen.getByText("3 images omitted")).toBeInTheDocument();
    expect(screen.getByText("12 thinking blocks omitted")).toBeInTheDocument();
    expect(screen.getByText("2 tool results truncated")).toBeInTheDocument();
    expect(screen.getByText("Context compaction state not carried")).toBeInTheDocument();
  });

  it("disables the confirm button while the preview loads", async () => {
    await renderDialog();

    expect(screen.getByRole("button", { name: "Create thread" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create thread" })).toBeEnabled());
  });

  it("shows the server reason and no confirm button when a handoff cannot run", async () => {
    const core = createFakeCore({ configured: true });
    await core.providers.setApiKey("openrouter", "fake");
    const { id } = await core.conversations.start({
      projectId: "home",
      text: "hi",
      requestId: "r0",
    } as never);
    const api = createApi(createFakeTransport(core));
    vi.spyOn(api.conversations, "handoffPreview").mockResolvedValue({
      canHandoff: false,
      reason: "This thread is busy.",
      losses: emptyHandoffLosses(),
      preview: "",
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NodeApiProvider api={api}>
          <MemoryRouter>
            <HandoffDialog conversationId={id} onClose={() => {}} />
          </MemoryRouter>
        </NodeApiProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("This thread is busy.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create thread" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Instruction (optional)")).not.toBeInTheDocument();
  });

  it("creates the thread with the instruction and opens it", async () => {
    const { id, api, onClose } = await renderDialog();
    const handoff = vi.spyOn(api.conversations, "handoff");
    const user = userEvent.setup();

    await waitFor(async () => expect(await confirmButton()).toBeEnabled());
    await user.type(screen.getByLabelText("Instruction (optional)"), "  run the tests  ");
    await user.click(await confirmButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(handoff).toHaveBeenCalledWith(id, { requestId: expect.any(String), instruction: "run the tests" });
    const created = await handoff.mock.results[0]?.value;
    expect(created.executor).toBe("claude-code");
    expect(screen.getByTestId("where")).toHaveTextContent(`/p/home/c/${created.id}`);
  });

  it("sends no instruction when the box is empty", async () => {
    const { api } = await renderDialog();
    const handoff = vi.spyOn(api.conversations, "handoff");

    await waitFor(async () => expect(await confirmButton()).toBeEnabled());
    await userEvent.setup().click(await confirmButton());

    await waitFor(() => expect(handoff).toHaveBeenCalled());
    expect(handoff.mock.calls[0]?.[1]).toEqual({ requestId: expect.any(String) });
  });

  it("shows the server error and keeps the same request id on retry", async () => {
    const { api, onClose } = await renderDialog();
    const handoff = vi
      .spyOn(api.conversations, "handoff")
      .mockRejectedValueOnce(new AppError("thread_busy", "This thread is busy."));
    const user = userEvent.setup();

    await waitFor(async () => expect(await confirmButton()).toBeEnabled());
    await user.click(await confirmButton());
    expect(await screen.findByText("This thread is busy.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(await confirmButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(handoff).toHaveBeenCalledTimes(2);
    expect(handoff.mock.calls[1]?.[1].requestId).toBe(handoff.mock.calls[0]?.[1].requestId);
  });
});
