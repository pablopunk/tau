import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessInfo } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { type ExitDetails, spawnRunning } from "./running-process";

function run(command: string) {
  const info = { command, urls: [], state: "running" } as unknown as ProcessInfo;
  let details: ExitDetails | undefined;
  const running = spawnRunning({
    info,
    cwd: tmpdir(),
    logPath: join(mkdtempSync(join(tmpdir(), "running-process-")), "log"),
    onUrls: () => undefined,
    onExit: (_info, exit) => {
      details = exit;
    },
  });
  return running.exited.then(() => ({ running, details: details as ExitDetails }));
}

describe("spawnRunning", () => {
  it("keeps every line printed right before the exit", async () => {
    const { running, details } = await run("seq 1 2000; echo last");
    expect(running.tail.text()).toContain("last");
    expect(details.exitCode).toBe(0);
  });

  it("finishes soon after the exit when a background child keeps the pipes open", async () => {
    const started = Date.now();
    const { running, details } = await run("sleep 5 & echo hi");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(running.tail.text()).toContain("hi");
    expect(details.exitCode).toBe(0);
  });
});
