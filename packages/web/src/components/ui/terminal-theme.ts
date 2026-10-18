import type { ITheme } from "@xterm/xterm";

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

export const TERMINAL_FONT_FAMILY = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function cssColor(host: HTMLElement, variable: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** Tokyo Night (dark) or Tokyo Night Day (light), read from the `--terminal-*` tokens in theme.css. */
export function terminalTheme(host: HTMLElement): ITheme {
  const color = (name: string) => cssColor(host, `--terminal-${name}`);
  const [black, red, green, yellow, blue, magenta, cyan, white] = ANSI.map(color);
  const [brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] =
    ANSI.map((name) => color(`bright-${name}`));
  return {
    background: color("bg"),
    foreground: color("fg"),
    cursor: color("cursor"),
    cursorAccent: color("cursor-accent"),
    selectionBackground: color("selection"),
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  };
}
