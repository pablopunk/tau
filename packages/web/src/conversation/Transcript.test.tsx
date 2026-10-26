import type { ConversationView } from "@tau/protocol";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerTestWrapper } from "./composer/test-wrapper";
import { clearPending, noteFailed, noteSending } from "./queue/pending-sends";
import { Transcript } from "./Transcript";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: {
    conversations: { send: mocks.send },
    approvals: { list: async () => [] },
  },
}));

const viewOf = (docs: Record<string, unknown>): ConversationView =>
  ({ conversation: { id: "c1" }, entries: [], docs }) as unknown as ConversationView;

const empty = viewOf({});
const message = { text: "hello out there", images: [], files: [] };

function renderTranscript(view: ConversationView) {
  return render(<Transcript view={view} conversationId="c1" />, { wrapper: ComposerTestWrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  clearPending();
});

describe("<Transcript> pending sends", () => {
  it("shows a sending bubble keyed by the receipt until live reflects it", () => {
    renderTranscript(empty);
    expect(screen.queryByText("hello out there")).not.toBeInTheDocument();
    act(() => noteSending("c1", { submissionId: 99 }, message));
    expect(screen.getByText("hello out there")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sending…");
  });

  it("morphs the bubble into the queued row on exact submission-id match", () => {
    const { rerender } = renderTranscript(empty);
    act(() => noteSending("c1", { submissionId: 99 }, message));
    expect(screen.getByText("hello out there")).toBeInTheDocument();
    // `rerender` keeps the initial wrapper: pass the view only, never nest it.
    rerender(
      <Transcript
        view={viewOf({ "pi.inbox": { items: [{ id: 99, mode: "followUp", content: "hello out there" }] } })}
        conversationId="c1"
      />,
    );
    // One row, not two: the queued row replaces the pending bubble.
    expect(screen.getAllByText("hello out there")).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send now" })).toBeInTheDocument();
  });

  it("drops the bubble when the entry commits on exact entry-id match", () => {
    const { rerender } = renderTranscript(empty);
    act(() => noteSending("c1", { submissionId: 99, entryId: 12 }, message));
    rerender(
      <Transcript
        view={
          {
            conversation: { id: "c1" },
            entries: [{ kind: "pi.user", id: 12, model: [{ role: "user", content: "hello out there" }] }],
            docs: {},
          } as unknown as ConversationView
        }
        conversationId="c1"
      />,
    );
    expect(screen.getAllByText("hello out there")).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("marks a failed bubble with retry and resends on retry", async () => {
    mocks.send.mockResolvedValue({ submissionId: 50 });
    renderTranscript(empty);
    act(() => noteFailed("c1", message, "Server unreachable"));
    expect(screen.getByRole("alert")).toHaveTextContent("Server unreachable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.send).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ text: "hello out there", requestId: expect.any(String) }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Sending…");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("<Transcript> notifications", () => {
  it("renders monitor events without treating them as assistant messages", () => {
    renderTranscript({
      ...empty,
      entries: [
        {
          kind: "app.monitor_event",
          id: 1,
          data: { processId: "monitor-1", description: "release", lines: ["published"], dropped: 0 },
        },
      ],
    } as unknown as ConversationView);
    expect(screen.getByText("published")).toBeInTheDocument();
  });
});

describe("<Transcript> done slots without entries", () => {
  it("renders a finished tool call from the slot until the entry commits", () => {
    const { container } = renderTranscript(
      viewOf({
        "pi.live": {
          run: { taskId: 1, inputs: [] },
          tools: [{ callId: "call-1", name: "bash", status: "done", output: "hi" }],
        },
      }),
    );
    // Finished, not skipped (F5): the slot row stands in for the missing entry.
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(container.querySelector('[data-tool-status="done"]')).not.toBeNull();
  });

  it("prefers the committed entry over the slot fallback", () => {
    renderTranscript({
      conversation: { id: "c1" },
      entries: [
        {
          kind: "pi.assistant",
          id: 3,
          model: [{ role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "bash" }] }],
        },
      ],
      docs: {
        "pi.live": {
          run: { taskId: 1, inputs: [] },
          tools: [{ callId: "call-1", name: "bash", status: "done", output: "hi" }],
        },
      },
    } as unknown as ConversationView);
    expect(screen.getAllByText("Bash")).toHaveLength(1);
  });
});
