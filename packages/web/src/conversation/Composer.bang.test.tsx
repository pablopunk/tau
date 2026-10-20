import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { BANG_EMPTY_ERROR } from "./composer/bang-mode";
import { ComposerTestWrapper } from "./composer/test-wrapper";

beforeEach(() => window.localStorage.clear());

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const compact = vi.fn().mockResolvedValue(undefined);
  render(
    <Composer
      target="new"
      imagesAllowed
      busy={false}
      toolbarStart={<span>start</span>}
      toolbar={<span>tool</span>}
      commands={{ compact }}
      onSend={onSend}
      {...props}
    />,
    { wrapper: ComposerTestWrapper },
  );
  return { onSend, compact, input: screen.getByLabelText("Message") };
}

describe("<Composer> bang mode", () => {
  it("switches to terminal styling and hides agent toolbar items on `! `", async () => {
    const { input } = setup();
    await userEvent.type(input, "! ls");
    expect(input).toHaveClass("font-mono");
    expect(input.parentElement).toHaveClass("border-[var(--terminal-green)]");
    expect(screen.getByTestId("bang-prompt")).toBeInTheDocument();
    expect(screen.queryByText("tool")).not.toBeInTheDocument();
    expect(screen.queryByText("start")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach images" })).not.toBeInTheDocument();
  });

  it("restores the normal composer when backspacing out of the prefix", async () => {
    const { input } = setup();
    await userEvent.type(input, "! ls");
    expect(input).toHaveClass("font-mono");
    await userEvent.keyboard("{Backspace}{Backspace}{Backspace}");
    expect(input).toHaveValue("!");
    expect(input).not.toHaveClass("font-mono");
    expect(input.parentElement).not.toHaveClass("border-[var(--terminal-green)]");
    expect(screen.queryByTestId("bang-prompt")).not.toBeInTheDocument();
    expect(screen.getByText("tool")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach images" })).toBeInTheDocument();
  });

  it("shows an inline error and sends nothing for bare `!`", async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, "!{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(BANG_EMPTY_ERROR);
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("!");
  });

  it("sends `!!` escapes verbatim without client-side stripping", async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, "!!wow{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "!!wow", images: [] });
  });

  it("sends bang text verbatim and never treats it as a slash command", async () => {
    const { onSend, compact, input } = setup();
    await userEvent.type(input, "!/compact{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "!/compact", images: [] });
    await userEvent.type(input, "! /compact{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "! /compact", images: [] });
    expect(compact).not.toHaveBeenCalled();
  });
});
