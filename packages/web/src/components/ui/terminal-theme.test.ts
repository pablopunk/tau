import { describe, expect, it, vi } from "vitest";
import { TERMINAL_FONT_FAMILY, terminalTheme } from "./terminal-theme";

/** jsdom does not resolve var(); echoing the requested value shows which token was read. */
vi.spyOn(window, "getComputedStyle").mockImplementation((el) => ({ color: (el as HTMLElement).style.color }) as CSSStyleDeclaration);

describe("terminal theme", () => {
  it("reads the full palette from the --terminal tokens", () => {
    const theme = terminalTheme(document.body);
    expect(theme.background).toBe("var(--terminal-bg)");
    expect(theme.selectionBackground).toBe("var(--terminal-selection)");
    expect(theme.cursorAccent).toBe("var(--terminal-cursor-accent)");
    expect(theme.red).toBe("var(--terminal-red)");
    expect(theme.brightWhite).toBe("var(--terminal-bright-white)");
  });

  it("puts JetBrains Mono first with a monospace fallback", () => {
    expect(TERMINAL_FONT_FAMILY.startsWith('"JetBrains Mono"')).toBe(true);
    expect(TERMINAL_FONT_FAMILY.endsWith("monospace")).toBe(true);
  });
});
