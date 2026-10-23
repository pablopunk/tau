import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
import { QueuedMessages } from "./QueuedMessages";

const mocks = vi.hoisted(() => ({
  sendNow: vi.fn(),
  cancelQueued: vi.fn(),
  setQueuedMode: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    conversations: {
      sendNow: mocks.sendNow,
      cancelQueued: mocks.cancelQueued,
      setQueuedMode: mocks.setQueuedMode,
      listAll: async () => [],
    },
  },
}));

const user = (id: number, mode: "followUp" | "steer", text: string) => ({
  id,
  mode,
  text,
  images: [],
  entryKind: "pi.user",
});
const notice = (id: number, text: string) =>
  ({ id, mode: "followUp" as const, text, images: [], entryKind: "app.bang" }) as ReturnType<typeof user>;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

function renderInbox() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider>
        <QueuedMessages
          conversationId="c1"
          items={[user(1, "followUp", "first"), notice(2, "exited 0"), user(3, "steer", "nudge")]}
        />
      </NodeApiProvider>
    </QueryClientProvider>,
  );
}

describe("<QueuedMessages>", () => {
  it("splits the inbox into Up next and Will steer within one animated list", () => {
    renderInbox();
    expect(screen.getByRole("heading", { name: "Up next" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Will steer" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Queued messages" });
    // Follow-ups (user + notification) render under Up next, steers under Will steer, in order.
    expect(list.textContent).toMatch(/Up next.*first.*notification.*Will steer.*nudge/s);
  });

  it("moves a mode-switched row across sections through one in-place RPC", async () => {
    mocks.setQueuedMode.mockResolvedValue({ switched: true });
    const view = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NodeApiProvider>
          <QueuedMessages conversationId="c1" items={[user(1, "followUp", "first")]} />
        </NodeApiProvider>
      </QueryClientProvider>,
    );
    const [steer] = screen.getAllByRole("button", { name: "Steer" });
    await userEvent.click(steer as HTMLElement);
    expect(mocks.setQueuedMode).toHaveBeenCalledWith("c1", "1", "steer");
    // The server flips the mode under the same id: the row re-renders under Will steer.
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NodeApiProvider>
          <QueuedMessages conversationId="c1" items={[user(1, "steer", "first")]} />
        </NodeApiProvider>
      </QueryClientProvider>,
    );
    const list = screen.getByRole("list", { name: "Queued messages" });
    expect(list.textContent).toMatch(/Will steer.*first/s);
    expect(screen.queryByRole("heading", { name: "Up next" })).not.toBeInTheDocument();
  });

  it("gives notification rows no action buttons", () => {
    renderInbox();
    // Two user items × (Send now + Steer + Queue + Cancel); the notification disclosure adds no queue actions.
    expect(screen.getAllByRole("button", { name: "Send now" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Steer" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Queue" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2);
  });

  it("cancels only per user item through the atomic RPC", async () => {
    mocks.cancelQueued.mockResolvedValue({ cancelled: true, restored: [] });
    renderInbox();
    const [cancel] = screen.getAllByRole("button", { name: "Cancel" });
    await userEvent.click(cancel as HTMLElement);
    expect(mocks.cancelQueued).toHaveBeenCalledWith("c1", "1");
  });

  it("renders nothing when the inbox is empty", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <NodeApiProvider>
          <QueuedMessages conversationId="c1" items={[]} />
        </NodeApiProvider>
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
