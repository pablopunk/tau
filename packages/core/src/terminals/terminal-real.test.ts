import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalTerminalDaemon } from "../harness/terminal-daemon";

const daemon = createLocalTerminalDaemon({ ...process.env, TAU_DISABLE_TERMINALS: undefined });
const usable = await daemon.available();

describe.skipIf(!usable)("real PTY", () => {
  it("runs /bin/sh in the folder", async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), "tau-pty-")));
    let output = "";
    const port = await daemon.open({
      cwd,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", SHELL: "/bin/sh", TERM: "xterm" },
      cols: 80,
      rows: 24,
      onData: (bytes) => {
        output += new TextDecoder().decode(bytes);
      },
    });
    port.write("echo $((6*7))\r");
    const deadline = Date.now() + 5000;
    while (!/42\r\n/.test(output) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(output).toMatch(/42\r\n/);
    port.close();
    await daemon.close();
  });
});
