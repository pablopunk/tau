import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKGROUND } from "./open";
import { callPrompt, openRig, type Rig } from "./subagent-test-support";

let root: string;
let rig: Rig;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "subagent-tools-")));
  await mkdir(join(root, "project"));
  rig = await openRig(root, join(root, "project"));
});

afterEach(async () => {
  await rig.close();
  await rm(root, { recursive: true, force: true });
});

const transcript = async (id: string) => JSON.stringify(await rig.entriesOf(id));

async function startParentWithChild(prompt: string, extra: object = {}) {
  const parent = await rig.start(callPrompt("agent", { description: "look around", prompt, ...extra }));
  const child = await rig.firstChild(parent.id);
  return { parent, child };
}

async function callOnParent(parentId: string, tool: string, args: object) {
  await rig.store.send(
    parentId,
    { text: callPrompt(tool, args), requestId: `c-${Math.random()}` },
    Date.now(),
  );
  await rig.idle(parentId);
}

describe("agent", () => {
  it("returns at once and reports the answer as a notification", async () => {
    const { parent, child } = await startParentWithChild("hello");
    await rig.idle(parent.id);
    expect(await transcript(parent.id)).toContain(`Started subagent ${child.id}`);
    const [notification] = await rig.notified(parent.id);
    expect(notification?.data).toMatchObject({ childId: child.id, status: "done", title: "look around" });
    expect(await rig.childrenOf(parent.id)).toMatchObject([
      { agentType: "general-purpose", agentStatus: "done", background: true },
    ]);
  });

  it("waits for the report with run_in_background false and posts no notification", async () => {
    const { parent, child } = await startParentWithChild("hello", { run_in_background: false });
    await rig.idle(parent.id);
    expect(await transcript(parent.id)).toContain("You said");
    expect(await rig.notificationsOf(parent.id)).toEqual([]);
    expect(await rig.childrenOf(parent.id)).toMatchObject([
      { id: child.id, agentStatus: "done", background: false },
    ]);
  });

  it("starts the child on the model asked for", async () => {
    const { child } = await startParentWithChild("hello", { model: "faux-2" });
    await rig.until(async () => (await rig.childrenOf(child.parentId ?? ""))[0]?.agentStatus === "done");
    const agent = await (await rig.conversationOf(child.id))?.agent(BACKGROUND);
    expect(agent?.model).toMatchObject({ modelId: "faux-2" });
    expect((await rig.childrenOf(child.parentId ?? ""))[0]?.agentModel).toMatchObject({ modelId: "faux-2" });
  });

  it("gives the child no subagent tools", async () => {
    const { child } = await startParentWithChild("hello");
    const agent = await (await rig.conversationOf(child.id))?.agent(BACKGROUND);
    const names = agent?.tools.map((tool) => tool.name) ?? [];
    expect(names).toContain("bash");
    expect(names).not.toContain("agent");
    expect(names).not.toContain("send_message");
  });

  it("rejects worktree isolation in a project that is not a git repository", async () => {
    const parent = await rig.start(
      callPrompt("agent", { description: "x", prompt: "hello", isolation: "worktree" }),
    );
    await rig.idle(parent.id);
    expect(await transcript(parent.id)).toContain("needs a project inside a git repository");
    expect(await rig.childrenOf(parent.id)).toEqual([]);
  });
});

describe("send_message", () => {
  it.each(["followUp", "steer"])("delivers a %s message and reports its answer", async (mode) => {
    const { parent, child } = await startParentWithChild("hello");
    await rig.notified(parent.id);
    await callOnParent(parent.id, "send_message", { to: child.id, message: "again", mode });
    const notifications = await rig.notified(parent.id, 2);
    expect(notifications).toHaveLength(2);
    expect(await transcript(child.id)).toContain("again");
  });

  it("only reaches the thread's own subagents", async () => {
    const { child } = await startParentWithChild("hello");
    const other = await rig.start("hello");
    await rig.idle(other.id);
    await callOnParent(other.id, "send_message", { to: child.id, message: "hijack" });
    expect(await transcript(other.id)).toContain("is not one of this thread's subagents");
    expect(await transcript(child.id)).not.toContain("hijack");
  });
});

describe("stop_agent", () => {
  it("aborts the child run and reports stopped", async () => {
    const { parent, child } = await startParentWithChild("bash sleep 30");
    await rig.until(async () => (await rig.store.find(child.id))?.status === "running");
    await callOnParent(parent.id, "stop_agent", { id: child.id });
    const [notification] = await rig.notified(parent.id);
    expect(notification?.data).toMatchObject({ childId: child.id, status: "stopped" });
    expect((await rig.childrenOf(parent.id))[0]?.agentStatus).toBe("stopped");
  });

  it("refuses a thread that is not one of its subagents", async () => {
    const parent = await rig.start("hello");
    await rig.idle(parent.id);
    await callOnParent(parent.id, "stop_agent", { id: parent.id });
    expect(await transcript(parent.id)).toContain("is not one of this thread's subagents");
  });
});

describe("list_agents", () => {
  it("lists id, description, type, model and status", async () => {
    const { parent, child } = await startParentWithChild("hello");
    await rig.notified(parent.id);
    await callOnParent(parent.id, "list_agents", {});
    const text = await transcript(parent.id);
    expect(text).toContain(`id\\": \\"${child.id}`);
    expect(text).toContain("general-purpose");
    expect(text).toContain("faux/faux-1");
    expect(text).toContain("look around");
  });

  it("says so when there are no subagents", async () => {
    const parent = await rig.start(callPrompt("list_agents", {}));
    await rig.idle(parent.id);
    expect(await transcript(parent.id)).toContain("You have no subagents.");
  });
});
