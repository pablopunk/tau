import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHotkey } from "./hotkeys";

function Harness({ combo, handler }: { combo: string; handler: () => void }) {
  useHotkey(combo, handler);
  return <textarea aria-label="Box" />;
}

const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };

describe("useHotkey", () => {
  it("fires Mod combos everywhere, including inside text inputs, and prevents the default", () => {
    const handler = vi.fn();
    render(<Harness combo="Mod+Shift+O" handler={handler} />);
    const event = new KeyboardEvent("keydown", {
      key: "O",
      shiftKey: true,
      ...modKey,
      bubbles: true,
      cancelable: true,
    });
    screen.getByLabelText("Box").dispatchEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores combos without Mod while typing in a text input", () => {
    const handler = vi.fn();
    render(<Harness combo="Escape" handler={handler} />);
    fireEvent.keyDown(screen.getByLabelText("Box"), { key: "Escape" });
    expect(handler).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire for a different modifier set", () => {
    const handler = vi.fn();
    render(<Harness combo="Mod+K" handler={handler} />);
    fireEvent.keyDown(document.body, { key: "k" });
    fireEvent.keyDown(document.body, { key: "k", shiftKey: true, ...modKey });
    expect(handler).not.toHaveBeenCalled();
  });
});
