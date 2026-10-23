import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantTextEvent,
  lifecycleEvent,
  nativeView,
  queueEvent,
  userEvent as userEntry,
} from "./native-fixtures";
import { clearPending, noteSending } from "./queue/pending-sends";
import { createStubLiveClient, endOf, renderConversation } from "./test-utils";

const mocks = vi.hoisted(() => {
  const piOnly = {
    compact: vi.fn(),
    fork: vi.fn(),
    rewind: vi.fn(),
    rewindPreview: vi.fn(),
    retry: vi.fn(),
    configure: vi.fn(),
    sendNow: vi.fn(),
    setQueuedMode: vi.fn(),
    cancelQueued: vi.fn(),
  };
  return { send: vi.fn(), abort: vi.fn(), piOnly };
});

vi.mock("@/lib/api", () => ({
  api: { conversations: { send: mocks.send, abort: mocks.abort, ...mocks.piOnly } },
}));

const running = nativeView([
  userEntry("u1", "r1", "refactor the parser"),
  lifecycleEvent("l1", "running"),
  assistantTextEvent("t1", "Working on it."),
  userEntry("u2", "r2", "also add tests"),
  queueEvent("q1", "r2", "queued"),
]);

beforeEach(() => {
  window.localStorage.clear();
  clearPending();
  mocks.send.mockReset().mockResolvedValue({ submissionId: 1 });
  mocks.abort.mockReset().mockResolvedValue({ restored: [] });
  for (const spy of Object.values(mocks.piOnly)) spy.mockReset();
});

function expectNoPiOnlyRequest() {
  for (const [name, spy] of Object.entries(mocks.piOnly)) expect(spy, name).not.toHaveBeenCalled();
}

describe("<Conversation> on a native thread", () => {
  it("labels the engine instead of showing the Pi model and thinking pickers", () => {
    renderConversation(createStubLiveClient(running));
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Thinking level" })).not.toBeInTheDocument();
  });

  it("reads busy and queued from native entries and stops through the existing stop action", async () => {
    renderConversation(createStubLiveClient(running));
    expect(screen.getByText("Up next")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Queued messages" })).toHaveTextContent("also add tests");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(mocks.abort).toHaveBeenCalledWith("2");
    expectNoPiOnlyRequest();
  });

  it("shows a queued follow-up once, under Up next, with no steer or queue-mode actions", () => {
    renderConversation(createStubLiveClient(running));
    expect(screen.getAllByText("also add tests")).toHaveLength(1);
    const queue = within(screen.getByRole("list", { name: "Queued messages" }));
    expect(queue.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers follow-up only: queue wording, and Alt+Enter never steers", async () => {
    renderConversation(createStubLiveClient(running));
    const input = screen.getByLabelText("Message");
    expect(input).toHaveAttribute("placeholder", "Queue a message…");
    expect(screen.getByRole("button", { name: "Queue message" })).toBeInTheDocument();
    await userEvent.type(input, "one more{Alt>}{Enter}{/Alt}");
    expect(mocks.send).toHaveBeenCalledWith(
      "2",
      expect.objectContaining({ text: "one more", whenBusy: "followUp" }),
    );
  });

  it("blocks attachments and says why", () => {
    renderConversation(createStubLiveClient(running));
    expect(screen.queryByRole("button", { name: "Attach files" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Attachments are not supported for native threads yet.",
    );
  });

  it("offers no Pi-only slash commands", async () => {
    renderConversation(createStubLiveClient(running));
    await userEvent.type(screen.getByLabelText("Message"), "/");
    expect(await screen.findByText("Rename this thread")).toBeInTheDocument();
    for (const hidden of ["Summarize older messages", "Change the model", "Change the thinking level"])
      expect(screen.queryByText(new RegExp(hidden))).not.toBeInTheDocument();
    expectNoPiOnlyRequest();
  });

  it("keeps the message actions that rewind or fork out of the transcript, unlike a Pi thread", () => {
    const pi = renderConversation(createStubLiveClient(endOf("text")));
    expect(screen.getAllByRole("button", { name: "Message actions" }).length).toBeGreaterThan(0);
    pi.unmount();
    renderConversation(createStubLiveClient(running));
    expect(screen.queryByRole("button", { name: "Message actions" })).not.toBeInTheDocument();
    expectNoPiOnlyRequest();
  });

  it("makes an unknown outcome visible in the transcript", () => {
    const view = nativeView([userEntry("u1", "r1", "go"), lifecycleEvent("l1", "outcome-unknown")]);
    renderConversation(createStubLiveClient(view));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Last run's outcome is unknown. Check the workspace before continuing.",
    );
    expect(screen.queryByRole("button", { name: /retry|reconcile/i })).not.toBeInTheDocument();
  });

  it("makes a blocked run visible with its reason", () => {
    const view = nativeView([
      userEntry("u1", "r1", "go"),
      lifecycleEvent("l1", "blocked", "needs a decision"),
    ]);
    renderConversation(createStubLiveClient(view));
    expect(screen.getByRole("alert")).toHaveTextContent("The run is blocked.");
    expect(screen.getByRole("alert")).toHaveTextContent("needs a decision");
  });

  it("shows the notice even when nothing else is in the transcript", () => {
    renderConversation(createStubLiveClient(nativeView([lifecycleEvent("l1", "outcome-unknown")])));
    expect(screen.queryByText("Send a message to start.")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("keeps the pending bubble until the native user event with the same requestId arrives", async () => {
    const client = createStubLiveClient(nativeView([lifecycleEvent("l1", "completed")]));
    renderConversation(client);
    act(
      () =>
        void noteSending(
          "2",
          { submissionId: 9, requestId: "req-1" },
          {
            text: "ship it",
            images: [],
            files: [],
          },
        ),
    );
    expect(screen.getByText("ship it")).toBeInTheDocument();
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    act(() =>
      client.push(nativeView([lifecycleEvent("l1", "completed"), userEntry("u1", "other", "unrelated")])),
    );
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    act(() =>
      client.push(
        nativeView([
          lifecycleEvent("l1", "completed"),
          userEntry("u1", "other", "unrelated"),
          userEntry("u2", "req-1", "ship it"),
        ]),
      ),
    );
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
    expect(screen.getAllByText("ship it")).toHaveLength(1);
  });
});
