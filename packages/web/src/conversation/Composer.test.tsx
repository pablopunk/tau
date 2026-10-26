import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfNode } from "@/nodes/node-apis";
import { Composer } from "./Composer";
import { restoreToComposer } from "./composer/restore";
import { ComposerTestWrapper } from "./composer/test-wrapper";
import { clearPending } from "./queue/pending-sends";
import { endOf, renderView, viewWhere } from "./test-utils";

const api = apiOfNode();

vi.mock("@/lib/api", () => ({ api: { conversations: { send: vi.fn(), abort: vi.fn() } } }));

const send = vi.mocked(api.conversations.send);
const abort = vi.mocked(api.conversations.abort);

beforeEach(() => {
  clearPending();
  window.localStorage.clear();
  send.mockReset().mockResolvedValue({ submissionId: 1 });
  abort.mockReset().mockResolvedValue({ restored: [] });
});

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onStop = vi.fn().mockResolvedValue(undefined);
  render(<Composer target="new" imagesAllowed busy={false} onSend={onSend} onStop={onStop} {...props} />, {
    wrapper: ComposerTestWrapper,
  });
  return { onSend, onStop, input: screen.getByLabelText("Message") };
}

describe("<Composer>", () => {
  it("renders the toolbar inside the input box and the footer outside it", () => {
    setup({ toolbar: <span>tool</span>, footer: <span>foot</span> });
    const box = screen.getByLabelText("Message").parentElement;
    expect(box).toContainElement(screen.getByText("tool"));
    expect(box).not.toContainElement(screen.getByText("foot"));
  });

  it("shows a restored message above what is already typed", async () => {
    const { input } = setup({ target: "c1" });
    await userEvent.type(input, "typing now");
    act(() => restoreToComposer("c1", { text: "cancelled", images: [] }));
    await waitFor(() => expect(input).toHaveValue("cancelled\n\ntyping now"));
  });

  it("sends on Enter, trims the text and clears the input", async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, "  hello  {Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "hello", images: [], files: [] });
    expect(input).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, "one{Shift>}{Enter}{/Shift}two");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("one\ntwo");
  });

  it("does not send while an input method is composing", () => {
    const { onSend, input } = setup();
    fireEvent.change(input, { target: { value: "かな" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send an empty message", async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("sends with the button", async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, "hi");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith({ text: "hi", images: [], files: [] });
  });

  it("restores the text and shows the error when sending fails", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("Server unreachable"));
    const { input } = setup({ onSend });
    await userEvent.type(input, "keep me{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unreachable");
    expect(input).toHaveValue("keep me");
  });

  it("offers steering and a stop button while busy, and stops", async () => {
    const { onStop, onSend, input } = setup({ busy: true });
    expect(input).toHaveAttribute("placeholder", "Steer at the next tool boundary…");
    await userEvent.type(input, "change course{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "change course", images: [], files: [] });
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("has no stop button when idle", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("labels the send button for the effective mode", async () => {
    const followUp = setup({ busy: true, whenBusy: "followUp" });
    expect(followUp.input).toHaveAttribute("placeholder", "Queue a message…");
    expect(screen.getByRole("button", { name: "Queue message" })).toBeInTheDocument();
    followUp.onSend.mockResolvedValue({ submissionId: 1 });
    await userEvent.type(followUp.input, "nudge{Enter}");
    expect(followUp.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: "nudge", whenBusy: "followUp" }),
    );
  });

  it("never aborts the run on Escape", async () => {
    const { onStop, input } = setup({ busy: true });
    await userEvent.type(input, "oops{Escape}");
    expect(onStop).not.toHaveBeenCalled();
    expect(input).toHaveValue("oops");
  });
});

describe("<Conversation> composer wiring", () => {
  it("sends through the api client with a fresh requestId per message", async () => {
    renderView(endOf("text"));
    const input = screen.getByLabelText("Message");
    await userEvent.type(input, "first{Enter}");
    await userEvent.type(input, "second{Enter}");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const [firstId, secondId] = send.mock.calls.map(([, body]) => body.requestId);
    expect(send.mock.calls[0]).toEqual(["2", { text: "first", requestId: firstId }]);
    expect(send.mock.calls[1]?.[1].text).toBe("second");
    expect(firstId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
  });

  it("shows the message as sending before the server answers, then keeps it on the receipt", async () => {
    let answer: (receipt: { submissionId: number }) => void = () => {};
    send.mockReset().mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderView(endOf("text"));
    await userEvent.type(screen.getByLabelText("Message"), "instant{Enter}");
    expect(screen.getByText("instant")).toBeInTheDocument();
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("");
    await act(async () => answer({ submissionId: 5 }));
    expect(screen.getByText("instant")).toBeInTheDocument();
  });

  it("turns the sending bubble into a failed one with retry when the send is rejected", async () => {
    send.mockReset().mockRejectedValueOnce(new Error("Server unreachable"));
    renderView(endOf("text"));
    await userEvent.type(screen.getByLabelText("Message"), "lost?{Enter}");
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("Server unreachable");
    expect(screen.getByText("lost?")).toBeInTheDocument();
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
    send.mockResolvedValueOnce({ submissionId: 6 });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("lost?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("steers while the conversation is busy and aborts with the stop button", async () => {
    renderView(viewWhere("steer", (view) => JSON.stringify(view.docs["pi.live"]).includes("running")));
    await userEvent.type(screen.getByLabelText("Message"), "also this{Enter}");
    expect(send).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(abort).toHaveBeenCalledWith("2");
  });

  it("shows no stop button when the conversation is idle", () => {
    renderView(endOf("text"));
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });
});
