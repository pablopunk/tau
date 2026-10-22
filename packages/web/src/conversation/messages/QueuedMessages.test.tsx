import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
import { QueuedMessages } from "./QueuedMessages";

const mocks = vi.hoisted(() => ({ send: vi.fn(), sendNow: vi.fn(), cancelQueued: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    conversations: {
      send: mocks.send,
      sendNow: mocks.sendNow,
      cancelQueued: mocks.cancelQueued,
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
  it("splits the inbox into Up next and Will steer", () => {
    renderInbox();
    expect(screen.getByRole("heading", { name: "Up next" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Will steer" })).toBeInTheDocument();
    const upNext = screen.getByRole("region", { name: "Up next" });
    expect(upNext).toHaveTextContent("first");
    expect(upNext).toHaveTextContent("notification");
    expect(screen.getByRole("region", { name: "Will steer" })).toHaveTextContent("nudge");
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
