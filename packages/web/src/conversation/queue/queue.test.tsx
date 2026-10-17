import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusyModeHint } from "./BusyModeHint";
import { QueuedItemActions } from "./QueuedItemActions";

const mocks = vi.hoisted(() => ({ cancelQueued: vi.fn(), messageMode: "steer" }));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: {
    conversations: { cancelQueued: mocks.cancelQueued },
    settings: { get: async () => ({ messageMode: mocks.messageMode }) },
  },
}));

const item = { id: 7, mode: "followUp" as const, text: "later", images: [] };

beforeEach(() => vi.clearAllMocks());

describe("<QueuedItemActions>", () => {
  it("shows the mode and cancels the queued item", async () => {
    mocks.cancelQueued.mockResolvedValue({ cancelled: true });
    render(<QueuedItemActions conversationId="c1" item={item} />);
    expect(screen.getByText("Queued")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.cancelQueued).toHaveBeenCalledWith("c1", "7");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("labels a steer item and toasts when the item was already delivered", async () => {
    mocks.cancelQueued.mockResolvedValue({ cancelled: false });
    render(<QueuedItemActions conversationId="c1" item={{ ...item, mode: "steer" }} />);
    expect(screen.getByText("Steering")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(toast.info).toHaveBeenCalled();
  });
});

describe("<BusyModeHint>", () => {
  const renderHint = (busy: boolean) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BusyModeHint busy={busy} />
      </QueryClientProvider>,
    );

  it("tells which key steers or queues per setting", async () => {
    mocks.messageMode = "queue";
    renderHint(true);
    expect(await screen.findByText("Enter: queue · Alt+Enter: steer")).toBeInTheDocument();
  });

  it("shows nothing when idle", () => {
    const { container } = renderHint(false);
    expect(container).toBeEmptyDOMElement();
  });
});
