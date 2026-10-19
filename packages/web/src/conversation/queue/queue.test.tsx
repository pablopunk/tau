import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
import { loadDraft } from "../composer/drafts";
import { BusyModeHint } from "./BusyModeHint";
import { QueuedItemActions } from "./QueuedItemActions";

const mocks = vi.hoisted(() => ({
  cancelQueued: vi.fn(),
  send: vi.fn(),
  abort: vi.fn(),
  messageMode: "steer",
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: {
    conversations: { cancelQueued: mocks.cancelQueued, send: mocks.send, abort: mocks.abort },
    settings: { get: async () => ({ messageMode: mocks.messageMode }) },
  },
}));

const item = { id: 7, mode: "followUp" as const, text: "later", images: [] };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("<QueuedItemActions>", () => {
  it("shows the mode and cancels the queued item", async () => {
    mocks.cancelQueued.mockResolvedValue({ cancelled: true });
    render(
      <NodeApiProvider>
        <QueuedItemActions conversationId="c1" item={item} />
      </NodeApiProvider>,
    );
    expect(screen.getByRole("button", { name: "Queue" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Steer" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.cancelQueued).toHaveBeenCalledWith("c1", "7");
    expect(toast.info).not.toHaveBeenCalled();
    expect(loadDraft("c1")).toBe("later");
  });

  it("labels a steer item and toasts when the item was already delivered", async () => {
    mocks.cancelQueued.mockResolvedValue({ cancelled: false });
    render(
      <NodeApiProvider>
        <QueuedItemActions conversationId="c1" item={{ ...item, mode: "steer" }} />
      </NodeApiProvider>,
    );
    expect(screen.getByRole("button", { name: "Steer" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(toast.info).toHaveBeenCalled();
    expect(loadDraft("c1")).toBe("");
  });
});

describe("<QueuedItemActions> mode and send now", () => {
  const renderActions = (others: (typeof item)[] = []) =>
    render(
      <NodeApiProvider>
        <QueuedItemActions conversationId="c1" item={item} others={others} />
      </NodeApiProvider>,
    );

  it("moves the item to steer by withdrawing and re-sending it", async () => {
    mocks.cancelQueued.mockResolvedValue({ cancelled: true });
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Steer" }));
    expect(mocks.cancelQueued).toHaveBeenCalledWith("c1", "7");
    expect(mocks.send).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ text: "later", whenBusy: "steer" }),
    );
  });

  it("does nothing when the current mode is chosen again", async () => {
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Queue" }));
    expect(mocks.cancelQueued).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("send now stops the run, then sends the item", async () => {
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Send now" }));
    expect(mocks.abort).toHaveBeenCalledWith("c1");
    expect(mocks.send).toHaveBeenCalledWith("c1", expect.objectContaining({ text: "later" }));
    expect(mocks.send.mock.calls[0]?.[1]).not.toHaveProperty("whenBusy");
  });
});

describe("<BusyModeHint>", () => {
  const renderHint = (busy: boolean) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NodeApiProvider>
          <BusyModeHint busy={busy} />
        </NodeApiProvider>
      </QueryClientProvider>,
    );

  it("tells which key steers or queues per setting", async () => {
    mocks.messageMode = "queue";
    renderHint(true);
    expect(await screen.findByText("⏎ queue · ⌘⏎ steer")).toBeInTheDocument();
  });

  it("shows nothing when idle", () => {
    const { container } = renderHint(false);
    expect(container).toBeEmptyDOMElement();
  });
});
