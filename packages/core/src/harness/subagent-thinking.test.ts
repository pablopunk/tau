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
  root = await realpath(await mkdtemp(join(tmpdir(), "subagent-thinking-")));
  await mkdir(join(root, "project"));
});

afterEach(async () => {
  await rig?.close();
  await rm(root, { recursive: true, force: true });
});

const typed = (name: string, thinking: AgentType["thinking"]): AgentType => ({
  name,
  description: name,
  source: "project-pi",
  tools: undefined,
  disallowedTools: [],
  model: undefined,
  thinking,
  prompt: "",
});

async function open(types: readonly AgentType[] = []) {
  rig = await openRig(root, join(root, "project"), { services: { agentTypes: typesDouble(types) } });
  return rig;
}

async function levelOf(r: Rig, childId: string) {
  return (await (await r.conversationOf(childId))?.agent(BACKGROUND))?.thinkingLevel;
}

async function spawn(r: Rig, args: object) {
  const parent = await r.start(callPrompt("agent", { description: "x", prompt: "hi", ...args }));
  return { parent, child: await r.firstChild(parent.id) };
}

describe("subagent thinking level", () => {
  it("inherits the level of the parent", async () => {
    const r = await open();
    const { child } = await spawn(r, {});
    expect(await levelOf(r, child.id)).toBe("off");
    expect(child.agentThinking).toBe("off");
  });

  it("uses the tool argument", async () => {
    const r = await open();
    const { child } = await spawn(r, { thinking: "low" });
    expect(await levelOf(r, child.id)).toBe("low");
    expect(child.agentThinking).toBe("low");
  });

  it("uses the level of the agent type when there is no argument", async () => {
    const r = await open([typed("deep", "high")]);
    const { child } = await spawn(r, { subagent_type: "deep" });
    expect(await levelOf(r, child.id)).toBe("high");
  });

  it("lets the tool argument win over the agent type", async () => {
    const r = await open([typed("deep", "high")]);
    const { child } = await spawn(r, { subagent_type: "deep", thinking: "minimal" });
    expect(await levelOf(r, child.id)).toBe("minimal");
  });

  it("clamps the level to what the child's model supports", async () => {
    const r = await open();
    const { child } = await spawn(r, { model: "faux-2", thinking: "high" });
    expect(await levelOf(r, child.id)).toBe("off");
    expect(child.agentThinking).toBe("off");
  });

  it("gives a fork the argument level", async () => {
    const r = await open();
    const { child } = await spawn(r, { subagent_type: "fork", thinking: "low" });
    expect(await levelOf(r, child.id)).toBe("low");
  });

  it("shows the level in list_agents", async () => {
    const r = await open();
    const { parent } = await spawn(r, { thinking: "low" });
    await r.notified(parent.id);
    await r.store.send(parent.id, { text: callPrompt("list_agents", {}), requestId: "list-1" }, Date.now());
    await r.until(async () => (await r.toolOutputs(parent.id)).includes("thinking"));
    expect(await r.toolOutputs(parent.id)).toContain('\\"thinking\\": \\"low\\"');
  });
});
