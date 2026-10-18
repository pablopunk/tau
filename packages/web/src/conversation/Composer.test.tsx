import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { Composer } from "./Composer";
import { restoreToComposer } from "./composer/restore";
import { ComposerTestWrapper } from "./composer/test-wrapper";
import { endOf, renderView, viewWhere } from "./test-utils";

vi.mock("@/lib/api", () => ({ api: { conversations: { send: vi.fn(), abort: vi.fn() } } }));

const send = vi.mocked(api.conversations.send);
const abort = vi.mocked(api.conversations.abort);

beforeEach(() => {
  window.localStorage.clear();
  send.mockReset().mockResolvedValue(undefined);
  abort.mockReset().mockResolvedValue(undefined);
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
    expect(onSend).toHaveBeenCalledWith({ text: "hello", images: [] });
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
    expect(onSend).toHaveBeenCalledWith({ text: "hi", images: [] });
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
    expect(input).toHaveAttribute("placeholder", "Steer the agent…");
    await userEvent.type(input, "change course{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "change course", images: [] });
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("has no stop button when idle", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
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
