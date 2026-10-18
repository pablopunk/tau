import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHotkey } from "@/lib/hotkeys";
import { TerminalView } from "./terminal-view";

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

function Harness({ shortcut, onLeave }: { shortcut: () => void; onLeave: () => void }) {
  useHotkey("mod+shift+o", shortcut);
  return (
    <>
      <button type="button">outside</button>
      <TerminalView onInput={() => {}} onResize={() => {}} onHandle={() => {}} onLeave={onLeave} />
    </>
  );
}

const combo = { key: "o", ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true };

describe("terminal view keys", () => {
  it("is a labelled region", () => {
    render(<Harness shortcut={() => {}} onLeave={() => {}} />);
    expect(screen.getByRole("region", { name: "Terminal" })).toBeInTheDocument();
  });

  it("stops global shortcuts while the terminal has focus", () => {
    const shortcut = vi.fn();
    render(<Harness shortcut={shortcut} onLeave={() => {}} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "outside" }), combo);
    expect(shortcut).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("region", { name: "Terminal" }), combo);
    expect(shortcut).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+Up leaves for the composer", () => {
    const onLeave = vi.fn();
    render(<Harness shortcut={() => {}} onLeave={onLeave} />);
    fireEvent.keyDown(screen.getByRole("region", { name: "Terminal" }), {
      key: "ArrowUp",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
