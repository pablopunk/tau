import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentType } from "../agents/agent-types";
import { BACKGROUND } from "./open";
import { callPrompt, openRig, type Rig, typesDouble } from "./subagent-test-support";

let root: string;
let rig: Rig | undefined;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "subagent-types-")));
  await mkdir(join(root, "project"));
});

afterEach(async () => {
  await rig?.close();
  await rm(root, { recursive: true, force: true });
});

const reader: AgentType = {
  name: "reader",
  description: "Reads files",
  source: "project-claude",
  tools: ["read"],
  disallowedTools: [],
  model: "faux-2",
  prompt: "You only read files.",
};

const broken: AgentType = { ...reader, name: "broken", tools: [], error: "its tools map to nothing" };

async function open(types: readonly AgentType[]) {
  rig = await openRig(root, join(root, "project"), {
    services: { agentTypes: typesDouble(types) },
  });
  return rig;
}

const transcript = async (r: Rig, id: string) => JSON.stringify(await r.entriesOf(id));

describe("agent types", () => {
  it("limits the tools, adds the prompt and takes the model of the type", async () => {
    const r = await open([reader]);
    const parent = await r.start(
      callPrompt("agent", { description: "read it", prompt: "hello", subagent_type: "reader" }),
    );
    const child = await r.firstChild(parent.id);
    const agent = await (await r.conversationOf(child.id))?.agent(BACKGROUND);
    expect(agent?.tools.map((tool) => tool.name)).toEqual(["read"]);
    expect(agent?.instructions).toContain("You only read files.");
    expect(agent?.model).toMatchObject({ modelId: "faux-2" });
    expect(child.agentType).toBe("reader");
  });

  it("lets the model argument win over the type's model", async () => {
    const r = await open([reader]);
    const parent = await r.start(
      callPrompt("agent", { description: "x", prompt: "hello", subagent_type: "reader", model: "faux-1" }),
    );
    const child = await r.firstChild(parent.id);
    expect((await (await r.conversationOf(child.id))?.agent(BACKGROUND))?.model).toMatchObject({
      modelId: "faux-1",
    });
  });

  it("rejects an unknown type and lists the available ones", async () => {
    const r = await open([reader]);
    const parent = await r.start(
      callPrompt("agent", { description: "x", prompt: "hi", subagent_type: "nope" }),
    );
    await r.idle(parent.id);
    expect(await transcript(r, parent.id)).toContain("Available: fork, reader");
    expect(await r.childrenOf(parent.id)).toEqual([]);
  });

  it("rejects a type whose tools map to nothing", async () => {
    const r = await open([broken]);
    const parent = await r.start(
      callPrompt("agent", { description: "x", prompt: "hi", subagent_type: "broken" }),
    );
    await r.idle(parent.id);
    expect(await transcript(r, parent.id)).toContain("its tools map to nothing");
  });

  it("fails with the options when the model alias matches nothing", async () => {
    const r = await open([]);
    const parent = await r.start(callPrompt("agent", { description: "x", prompt: "hi", model: "opus" }));
    await r.idle(parent.id);
    expect(await transcript(r, parent.id)).toContain("No model matches opus");
  });
});

describe("fork subagents", () => {
  async function forkAfterHistory() {
    const r = await open([]);
    const parent = await r.start("remember the word pineapple");
    await r.idle(parent.id);
    await r.store.send(
      parent.id,
      {
        text: callPrompt("agent", { description: "forked", prompt: "carry on", subagent_type: "fork" }),
        requestId: "fork-1",
      },
      Date.now(),
    );
    const child = await r.firstChild(parent.id);
    return { r, parent, child };
  }

  it("keeps the parent's history, ends before the calling tool call and reports back", async () => {
    const { r, parent, child } = await forkAfterHistory();
    const [notification] = await r.notified(parent.id);
    expect(notification?.data).toMatchObject({ childId: child.id, status: "done" });
    const history = await transcript(r, child.id);
    expect(history).toContain("remember the word pineapple");
    expect(history).toContain("carry on");
    expect(history).not.toContain("toolCall");
    expect(child.agentType).toBe("fork");
  });

  it("tells the fork it is a fork with the parent's history, cannot spawn and reports back", async () => {
    const { r, child } = await forkAfterHistory();
    const agent = await (await r.conversationOf(child.id))?.agent(BACKGROUND);
    expect(agent?.instructions).toContain("fork of the parent");
    expect(agent?.instructions).toContain("cannot spawn subagents");
    expect(agent?.instructions).toContain("reported back to the parent");
  });

  it("runs in the background by default, so the call returns before the fork answers", async () => {
    const { r, parent } = await forkAfterHistory();
    expect(await transcript(r, parent.id)).toContain("Started subagent");
  });

  it("gives the fork the parent's model and no subagent tools", async () => {
    const { r, child } = await forkAfterHistory();
    const agent = await (await r.conversationOf(child.id))?.agent(BACKGROUND);
    expect(agent?.model).toMatchObject({ modelId: "faux-1" });
    expect(agent?.tools.map((tool) => tool.name)).not.toContain("agent");
  });
});
