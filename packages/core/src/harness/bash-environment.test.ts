import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tauShellEnvironment } from "./coding-tools";
import { callPrompt, openRig, type Rig } from "./subagent-test-support";

let root: string;
let rig: Rig;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "bash-env-")));
  await mkdir(join(root, "project"));
  rig = await openRig(root, join(root, "project"));
});

afterEach(async () => {
  await rig.close();
  await rm(root, { recursive: true, force: true });
});

const echoThreadId = callPrompt("bash", { command: "echo thread=$TAU_THREAD_ID=end" });
const printedId = (outputs: string) => /thread=(\d+)=end/.exec(outputs)?.[1];

describe("bash TAU_THREAD_ID", () => {
  it("is the thread id of the conversations list in a main thread", async () => {
    const thread = await rig.start(echoThreadId);
    await rig.idle(thread.id);
    const [listed] = await rig.store.list(rig.project.id);
    expect(printedId(await rig.toolOutputs(thread.id))).toBe(listed?.id);
    expect(listed?.id).toBe(thread.id);
  });

  it("is the subagent's own id in a subagent", async () => {
    const parent = await rig.start(
      callPrompt("agent", { description: "echo", prompt: echoThreadId, run_in_background: false }),
    );
    const child = await rig.firstChild(parent.id);
    await rig.idle(parent.id);
    await rig.idle(child.id);
    const listedIds = (await rig.store.list(rig.project.id)).map((thread) => thread.id);
    expect(listedIds).toContain(child.id);
    // The tool output can land a moment after the thread reports idle when the machine is busy.
    await vi.waitFor(async () => expect(printedId(await rig.toolOutputs(child.id))).toBe(child.id));
    expect(child.id).not.toBe(parent.id);
  });
});

describe("tauShellEnvironment", () => {
  const run = (home: string | undefined) => {
    const execution = { command: "", cwd: "/", env: {} as Record<string, string>, inheritEnv: true };
    tauShellEnvironment(home)(execution, { conversationId: 7 } as never, {} as never);
    return execution.env;
  };

  it("puts <home>/bin first on PATH and sets TAU_HOME", () => {
    const env = run("/h");
    expect(env.PATH?.startsWith(`${join("/h", "bin")}${delimiter}`)).toBe(true);
    expect(env.TAU_HOME).toBe("/h");
    expect(env.TAU_THREAD_ID).toBe("7");
  });

  it("only sets the thread id without a home", () => {
    expect(run(undefined)).toEqual({ TAU_THREAD_ID: "7" });
  });
});
