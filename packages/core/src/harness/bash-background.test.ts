import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callPrompt, openRig, type Rig } from "./subagent-test-support";

let root: string;
let rig: Rig;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "bash-bg-")));
  await mkdir(join(root, "project"));
  rig = await openRig(root, join(root, "project"));
});

afterEach(async () => {
  await rig.close();
  await rm(root, { recursive: true, force: true });
});

const bash = (command: string, timeout?: number) =>
  callPrompt("bash", timeout === undefined ? { command } : { command, timeout });

async function runningCallId(threadId: string): Promise<string> {
  let found: string | undefined;
  await rig.until(async () => {
    const entries = await rig.entriesOf(threadId);
    found = JSON.stringify(entries).match(/"id":"([^"]+)","name":"bash"/)?.[1];
    return found !== undefined;
  });
  return found as string;
}

describe("bash", () => {
  it("returns the output and the exit status of a command", async () => {
    const thread = await rig.start(bash("echo out; exit 2"));
    await rig.idle(thread.id);
    const outputs = await rig.toolOutputs(thread.id);
    expect(outputs).toContain("out");
    expect(outputs).toContain("Command exited with code 2");
    expect(await rig.processes.list(thread.id)).toEqual([]);
  });

  it("fails a command that outlives its timeout", async () => {
    const thread = await rig.start(bash("sleep 30", 1));
    await rig.idle(thread.id);
    expect(await rig.toolOutputs(thread.id)).toContain("Command timed out after 1 seconds");
  });

  it("moves a running command to the background: the call ends, the command does not", async () => {
    const thread = await rig.start(bash("echo before; sleep 1; echo after"));
    const callId = await runningCallId(thread.id);
    await rig.until(async () => {
      try {
        await rig.processes.background(thread.id, callId);
        return true;
      } catch {
        return false;
      }
    });
    await rig.idle(thread.id);
    const outputs = await rig.toolOutputs(thread.id);
    expect(outputs).toContain("moved this command to the background");
    expect(outputs).not.toContain("after\\n");
    const [info] = await rig.processes.list(thread.id);
    expect(info).toMatchObject({ command: "echo before; sleep 1; echo after" });
    const id = info?.id as string;
    // The natural exit notifies the thread, then prunes the row: the list drains.
    await rig.until(async () => (await rig.processes.list(thread.id)).length === 0);
    // Pruned: no log to read, and stop stays idempotent.
    await expect(rig.processes.logs(id, 5)).rejects.toMatchObject({ code: "not_found" });
    await rig.processes.stop(id);
  });
});
