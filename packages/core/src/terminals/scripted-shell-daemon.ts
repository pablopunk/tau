import type { TerminalDaemon } from "../harness/terminal-daemon";
import { createFakeTerminalDaemon, type FakeTerminalDaemon } from "./fake-terminal-daemon";

const PROMPT = "$ ";

/** A fake daemon whose shells echo typed text, run `echo x`, and exit on `exit`. For the contract suite. */
export function createScriptedShellDaemon(): TerminalDaemon {
  const daemon: FakeTerminalDaemon = createFakeTerminalDaemon();
  const open = daemon.open.bind(daemon);
  daemon.open = async (options) => {
    const port = await open(options);
    const handle = daemon.terminals[daemon.terminals.length - 1];
    let line = "";
    handle?.output(PROMPT);
    return {
      ...port,
      write(data) {
        for (const char of typeof data === "string" ? data : new TextDecoder().decode(data)) {
          if (char !== "\r") {
            line += char;
            handle?.output(char);
            continue;
          }
          const text = line.trim();
          line = "";
          const exit = /^exit(?:\s+(\d+))?$/.exec(text);
          if (exit) return handle?.exit(Number(exit[1] ?? 0));
          handle?.output(`\r\n${text.startsWith("echo ") ? `${text.slice(5)}\r\n` : ""}${PROMPT}`);
        }
      },
    };
  };
  return daemon;
}
