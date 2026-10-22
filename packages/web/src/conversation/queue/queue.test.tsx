import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
import { loadDraft } from "../composer/drafts";
import { loadFileAttachments } from "../files/attachments";
import { BusyModeHint } from "./BusyModeHint";
import { QueuedItemActions } from "./QueuedItemActions";

const mocks = vi.hoisted(() => ({
  sendNow: vi.fn(),
  cancelQueued: vi.fn(),
  abort: vi.fn(),
  messageMode: "steer",
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: {
    conversations: {
      sendNow: mocks.sendNow,
      cancelQueued: mocks.cancelQueued,
      abort: mocks.abort,
    },
    settings: { get: async () => ({ messageMode: mocks.messageMode }) },
  },
}));

const item = { id: 7, mode: "followUp" as const, text: "later", images: [], entryKind: "pi.user" };
const notification = { ...item, id: 9, text: "done", entryKind: "app.bang" } as typeof item;

function renderActions(itemProp: typeof item = item) {
  const onBusyChange = vi.fn();
  const view = render(
    <NodeApiProvider>
      <Harness item={itemProp} onBusyChange={onBusyChange} />
    </NodeApiProvider>,
  );
  return { ...view, onBusyChange };
}

/** Stateful parent: holds the shared busy flag across every queued-item row. */
function Harness({
  item: harnessItem,
  onBusyChange,
}: {
  item: typeof item;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <QueuedItemActions
      conversationId="c1"
      item={harnessItem}
      busy={busy}
      onBusyChange={(next) => {
        setBusy(next);
        onBusyChange(next);
      }}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("<QueuedItemActions>", () => {
  it("sends now with one atomic RPC and restores the unselected items from the response", async () => {
    mocks.sendNow.mockResolvedValue({
      submissionId: 42,
      restored: [{ text: "first", files: [] }],
    });
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Send now" }));
    expect(mocks.sendNow).toHaveBeenCalledTimes(1);
    expect(mocks.sendNow).toHaveBeenCalledWith("c1", "7");
    expect(loadDraft("c1")).toBe("first");
  });

  it("disables every queued-item button while an action is in flight", async () => {
    let release!: (value: { submissionId: number; restored: never[] }) => void;
    mocks.sendNow.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { onBusyChange } = renderActions();
    const sendNow = screen.getByRole("button", { name: "Send now" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await userEvent.click(sendNow);
    // Busy: every queued-item button disables until the RPC settles.
    await vi.waitFor(() => expect(sendNow).toBeDisabled());
    expect(cancel).toBeDisabled();
    // Clicks while busy are no-ops: no double admission (F3).
    await userEvent.click(sendNow);
    await userEvent.click(cancel);
    expect(mocks.sendNow).toHaveBeenCalledTimes(1);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    release({ submissionId: 42, restored: [] });
    await vi.waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(false));
  });

  it("offers no per-item mode buttons", () => {
    renderActions();
    expect(screen.queryByRole("button", { name: "Steer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Queue" })).not.toBeInTheDocument();
  });

  it("cancels and restores files from the server snapshot", async () => {
    mocks.cancelQueued.mockResolvedValue({
      cancelled: true,
      restored: [{ text: "with file", files: [{ name: "a.txt", path: "a.txt", size: 1 }] }],
    });
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.cancelQueued).toHaveBeenCalledWith("c1", "7");
    expect(toast.info).not.toHaveBeenCalled();
    expect(loadDraft("c1")).toBe("with file");
    expect(loadFileAttachments("c1").map((file) => file.ref.name)).toEqual(["a.txt"]);
  });

  it("falls back to the row content when the node predates snapshots", async () => {
    mocks.cancelQueued.mockResolvedValue({ cancelled: true, restored: [] });
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(loadDraft("c1")).toBe("later");
  });

  it("toasts when the item was already delivered", async () => {
    mocks.cancelQueued.mockResolvedValue({ cancelled: false, restored: [] });
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(toast.info).toHaveBeenCalled();
    expect(loadDraft("c1")).toBe("");
  });

  it("renders no actions for a notification item", () => {
    const { container } = renderActions(notification);
    expect(container).toBeEmptyDOMElement();
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
