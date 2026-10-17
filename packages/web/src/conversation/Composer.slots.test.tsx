import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { ComposerTestWrapper } from "./composer/test-wrapper";

beforeEach(() => window.localStorage.clear());

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(<Composer target="new" imagesAllowed busy={false} onSend={onSend} {...props} />, {
    wrapper: ComposerTestWrapper,
  });
  return { onSend, input: screen.getByLabelText("Message") };
}

describe("<Composer> slots", () => {
  it("renders toolbarStart in the box and abovePanel outside it", () => {
    setup({ toolbarStart: <span>start</span>, abovePanel: <span>panel</span> });
    const box = screen.getByLabelText("Message").parentElement;
    expect(box).toContainElement(screen.getByText("start"));
    expect(box).not.toContainElement(screen.getByText("panel"));
  });

  it("words the busy placeholder as Queue in queue mode", () => {
    expect(setup({ busy: true, whenBusy: "followUp" }).input).toHaveAttribute(
      "placeholder",
      "Queue a message…",
    );
  });

  it("words the busy placeholder as Steer in steer mode", () => {
    expect(setup({ busy: true, whenBusy: "steer" }).input).toHaveAttribute("placeholder", "Steer the agent…");
  });

  it("sends with the default mode on Enter and the other one on Alt+Enter while busy", async () => {
    const { onSend, input } = setup({ busy: true, whenBusy: "followUp" });
    await userEvent.type(input, "one{Enter}");
    expect(onSend).toHaveBeenLastCalledWith({ text: "one", images: [], whenBusy: "followUp" });
    await userEvent.type(input, "two{Alt>}{Enter}{/Alt}");
    expect(onSend).toHaveBeenLastCalledWith({ text: "two", images: [], whenBusy: "steer" });
  });

  it("adds no whenBusy when idle", async () => {
    const { onSend, input } = setup({ whenBusy: "steer" });
    await userEvent.type(input, "hi{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "hi", images: [] });
  });
});
