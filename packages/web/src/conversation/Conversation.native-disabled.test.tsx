import { describeExecutors, type RuntimeCapabilities, type RuntimeDescriptorList } from "@tau/protocol";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lifecycleEvent, nativeView, queueEvent, userEvent as userEntry } from "./native-fixtures";
import { clearPending } from "./queue/pending-sends";
import { createStubLiveClient, endOf, renderConversation } from "./test-utils";

const mocks = vi.hoisted(() => ({ send: vi.fn(), abort: vi.fn(), runtimes: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    conversations: { send: mocks.send, abort: mocks.abort },
    runtimes: { list: mocks.runtimes },
  },
}));

const NATIVE_CAPABILITIES = describeExecutors(undefined).executors[1]?.capabilities as RuntimeCapabilities;
const READ_ONLY = "disabled on this node; existing native threads are read-only";

const retained = (): RuntimeDescriptorList => ({
  executors: describeExecutors(undefined).executors.map((item) =>
    item.executor === "claude-code" ? { ...item, reason: READ_ONLY } : item,
  ),
});

const idle = nativeView([userEntry("u1", "r1", "refactor the parser"), lifecycleEvent("l1", "completed")]);
const running = nativeView([
  userEntry("u1", "r1", "refactor the parser"),
  lifecycleEvent("l1", "running"),
  queueEvent("q1", "r1", "delivered"),
]);

beforeEach(() => {
  window.localStorage.clear();
  clearPending();
  mocks.send.mockReset().mockResolvedValue({ submissionId: 1 });
  mocks.abort.mockReset().mockResolvedValue({ restored: [] });
  mocks.runtimes.mockReset().mockResolvedValue(describeExecutors(NATIVE_CAPABILITIES));
});

describe("<Conversation> on a native thread whose node disabled Claude Code", () => {
  it("disables sending and says why, keeping the transcript readable", async () => {
    mocks.runtimes.mockResolvedValue(retained());
    renderConversation(createStubLiveClient(idle));

    expect(
      await screen.findByText("Disabled on this node; existing native threads are read-only."),
    ).toBeVisible();
    expect(screen.getByText("refactor the parser")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Message"), "more{Enter}");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("keeps Stop usable while the composer is disabled", async () => {
    mocks.runtimes.mockResolvedValue(retained());
    renderConversation(createStubLiveClient(running));

    await screen.findByText("Disabled on this node; existing native threads are read-only.");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(mocks.abort).toHaveBeenCalledWith("2");
  });

  it("leaves the composer enabled while Claude Code is enabled", async () => {
    renderConversation(createStubLiveClient(idle));
    await waitFor(() => expect(mocks.runtimes).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText("Message"), "go{Enter}");

    expect(mocks.send).toHaveBeenCalledWith("2", expect.objectContaining({ text: "go" }));
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
  });

  it("leaves the composer enabled when the node cannot answer", async () => {
    mocks.runtimes.mockRejectedValue(new Error("old node"));
    renderConversation(createStubLiveClient(idle));
    await waitFor(() => expect(mocks.runtimes).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText("Message"), "go{Enter}");

    expect(mocks.send).toHaveBeenCalled();
  });

  it("never disables a Pi thread, and never asks the node for its runtimes", async () => {
    mocks.runtimes.mockResolvedValue(retained());
    renderConversation(createStubLiveClient(endOf("text")));

    await userEvent.type(screen.getByLabelText("Message"), "hi{Enter}");

    expect(mocks.send).toHaveBeenCalled();
    expect(mocks.runtimes).not.toHaveBeenCalled();
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
  });
});
