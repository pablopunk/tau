import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitFile, makeRepo } from "../workspaces/workspace-test-support";
import { callPrompt, openRig, type Rig } from "./subagent-test-support";

const COMMIT = "git -c user.name=T -c user.email=t@t.t commit -q -m work";

let root: string;
let repo: string;
let rig: Rig;

beforeEach(async () => {
  const made = await makeRepo();
  root = made.root;
  repo = made.repo;
  rig = await openRig(root, repo, { project: { kind: "git", isGitRepo: true } });
});

afterEach(async () => {
  await rig.close();
  await rm(root, { recursive: true, force: true });
});

const transcript = (id: string) => rig.toolOutputs(id);

const writeAndCommit = (file: string, text: string) =>
  `bash echo ${text} > ${file} && git add ${file} && ${COMMIT}`;

async function isolatedChild(prompt: string) {
  const parent = await rig.start(
    callPrompt("agent", { description: "worker", prompt, isolation: "worktree" }),
  );
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

describe("worktree isolation", () => {
  it("gives the child its own worktree and branch", async () => {
    const { parent, child } = await isolatedChild("hello");
    await rig.notified(parent.id);
    expect(child.workspace).toMatchObject({ mode: "worktree", state: "ready" });
    expect(child.workspace.path).not.toBe(repo);
    await callOnParent(parent.id, "list_agents", {});
    expect(await transcript(parent.id)).toContain(child.workspace.path);
  });
});

describe("merge_agent", () => {
  it("fast-forwards the committed work of a finished child into the checkout", async () => {
    const { parent, child } = await isolatedChild(writeAndCommit("note.txt", "hi"));
    await rig.notified(parent.id);
    await callOnParent(parent.id, "merge_agent", { id: child.id });
    expect(await transcript(parent.id)).toContain(`Merged subagent ${child.id} into main`);
    expect(await readFile(join(repo, "note.txt"), "utf8")).toBe("hi\n");
  });

  it("refuses while the child is running", async () => {
    const { parent, child } = await isolatedChild("bash sleep 30");
    await rig.until(async () => (await rig.store.find(child.id))?.status === "running");
    await callOnParent(parent.id, "merge_agent", { id: child.id });
    expect(await transcript(parent.id)).toContain("is still running");
    await rig.store.abort(child.id);
  });

  it("fails on a conflict and tells the agent to ask the child to resolve it", async () => {
    const { parent, child } = await isolatedChild(writeAndCommit("hello.txt", "from-child"));
    await rig.notified(parent.id);
    await commitFile(repo, "hello.txt", "from-main\n");
    await callOnParent(parent.id, "merge_agent", { id: child.id });
    const text = await transcript(parent.id);
    expect(text).toContain("hit conflicts and nothing was merged");
    expect(text).toContain("send_message");
    expect(await readFile(join(repo, "hello.txt"), "utf8")).toBe("from-main\n");
  });

  it("only merges the thread's own subagents", async () => {
    const { child } = await isolatedChild("hello");
    const other = await rig.start(callPrompt("merge_agent", { id: child.id }));
    await rig.idle(other.id);
    expect(await transcript(other.id)).toContain("is not one of this thread's subagents");
  });

  it("refuses a child without a worktree", async () => {
    const parent = await rig.start(callPrompt("agent", { description: "plain", prompt: "hello" }));
    const child = await rig.firstChild(parent.id);
    await rig.notified(parent.id);
    await callOnParent(parent.id, "merge_agent", { id: child.id });
    expect(await transcript(parent.id)).toContain("has no worktree");
  });
});

describe("remove_agent with a worktree", () => {
  it("refuses unmerged work, then removes it with force", async () => {
    const { parent, child } = await isolatedChild(writeAndCommit("note.txt", "hi"));
    await rig.notified(parent.id);
    await callOnParent(parent.id, "remove_agent", { ids: [child.id] });
    expect(await transcript(parent.id)).toContain("force true");
    expect(await rig.store.find(child.id)).toBeDefined();
    await callOnParent(parent.id, "remove_agent", { ids: [child.id], force: true });
    expect(await rig.store.find(child.id)).toBeUndefined();
  });

  it("removes a merged child without force", async () => {
    const { parent, child } = await isolatedChild(writeAndCommit("note.txt", "hi"));
    await rig.notified(parent.id);
    await callOnParent(parent.id, "merge_agent", { id: child.id });
    await callOnParent(parent.id, "remove_agent", { ids: [child.id] });
    expect(await rig.store.find(child.id)).toBeUndefined();
  });
});
