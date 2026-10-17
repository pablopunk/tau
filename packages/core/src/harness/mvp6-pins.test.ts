import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
  type InboxState,
  type LiveState,
} from "@earendil-works/pi-durable";
import { SUBAGENT_NOTIFICATION_KIND } from "@pi-everywhere/protocol";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFauxSetup } from "../testing/faux-provider";
import { legacyWorkspace } from "./conversation-index";
import { type ConversationStore, createConversationStore } from "./conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./open";
import { createAgentRegistry, LEGACY_TOOL_FILES, TOOL_FILES } from "./registry";
import { startBackgroundChild, startForkedBackgroundChild } from "./subagent-runtime";
import { createToolServicesRef } from "./tools/tool-file";

const FAUX = { provider: "faux", modelId: "faux-1" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PinHooks = { rerunSameCall: boolean; crashAfterCommit: boolean; release: (() => void) | undefined };

let root: string;
let project: string;
let harness: Harness | undefined;
let store: ConversationStore;
let hooks: PinHooks;

function pinAgentExtension(): Extension {
  const agent = defineTool({
    name: "agent",
    description: "pin",
    parameters: Type.Object({ description: Type.String(), prompt: Type.String() }),
    replay: "unsafe",
    execute: async (args, api, context) => {
      const spec = {
        description: args.description,
        prompt: args.prompt,
        agent: { type: "general-purpose", model: FAUX, background: true },
        withoutExtension: extension,
      };
      const childId = await startBackgroundChild(api, context, spec);
      if (hooks.rerunSameCall) await startBackgroundChild(api, context, spec);
      if (hooks.crashAfterCommit) {
        await new Promise<void>((_, reject) => {
          hooks.release = () => reject(new Error("crash after commit"));
        });
      }
      return { output: [{ type: "text", text: `Started subagent ${childId}.` }] };
    },
  });
  const forkAgent = defineTool({
    name: "fork_agent",
    description: "pin",
    parameters: Type.Object({ description: Type.String(), prompt: Type.String() }),
    replay: "unsafe",
    execute: async (args, api, context) => {
      const agent = { type: "fork", model: FAUX, background: true };
      const childId = await startForkedBackgroundChild(api, context, { ...args, agent });
      return { output: [{ type: "text", text: `Started subagent ${childId}.` }] };
    },
  });
  const extension: Extension = defineExtension({ name: "pin-agent", tools: [agent, forkAgent] });
  return extension;
}

async function open(options: { legacyTask?: boolean } = {}) {
  const registry = createAgentRegistry(
    createToolServicesRef(),
    options.legacyTask ? LEGACY_TOOL_FILES : TOOL_FILES,
  );
  registry.install(pinAgentExtension());
  harness = await openAgentHarness({
    storage: await openSqliteStorage(join(root, "agent.sqlite")),
    models: createFauxSetup().models,
    registry,
  });
  store = createConversationStore(harness, async () => project);
  return harness;
}

async function restart(options: { legacyTask?: boolean } = {}) {
  await harness?.close(BACKGROUND);
  return open(options);
}

async function startThread(text: string, requestId: string) {
  const { summary } = await store.start({
    project: {
      id: "p1",
      name: "main",
      path: project,
      createdAt: 0,
      kind: "folder",
      status: "ready",
      isGitRepo: false,
    },
    model: FAUX,
    thinkingLevel: "off",
    input: { text, requestId },
    workspace: legacyWorkspace(project),
    now: Date.now(),
  });
  return summary;
}

async function conversationOf(h: Harness, id: string) {
  return h.conversation(Number(id) as never, BACKGROUND);
}

async function untilIdle(h: Harness, id: string) {
  const conversation = await conversationOf(h, id);
  await conversation?.waitForIdle(BACKGROUND);
  return conversation;
}

async function isRunning(h: Harness, id: string) {
  const view = await (await conversationOf(h, id))?.viewState(BACKGROUND);
  const running = (view?.value.docs["pi.live"] as LiveState | undefined)?.run !== undefined;
  view?.dispose();
  return running;
}

async function inboxOf(h: Harness, id: string): Promise<InboxState["items"]> {
  const view = await (await conversationOf(h, id))?.viewState(BACKGROUND);
  const items = (view?.value.docs["pi.inbox"] as InboxState | undefined)?.items ?? [];
  view?.dispose();
  return items;
}

async function until(check: () => Promise<boolean>, attempts = 400) {
  for (let attempt = 0; attempt < attempts && !(await check()); attempt++) await sleep(25);
}

async function entriesOf(h: Harness, id: string) {
  const page = await (await conversationOf(h, id))?.entries({}, 200, undefined, BACKGROUND);
  return page?.items ?? [];
}

const notificationsOf = async (h: Harness, id: string) =>
  (await entriesOf(h, id)).filter((entry) => entry.kind === SUBAGENT_NOTIFICATION_KIND);

async function childrenOf(parentId: string) {
  return (await store.list("p1")).filter((thread) => thread.parentId === parentId);
}

async function untilChild(parentId: string) {
  await until(async () => (await childrenOf(parentId)).length > 0);
  return (await childrenOf(parentId))[0]!;
}

const untilNotified = (h: Harness, id: string) =>
  until(async () => (await notificationsOf(h, id)).length > 0);

beforeEach(async () => {
  hooks = { rerunSameCall: false, crashAfterCommit: false, release: undefined };
  root = await realpath(await mkdtemp(join(tmpdir(), "pie-mvp6-pins-")));
  project = join(root, "project");
  await mkdir(project);
});

afterEach(async () => {
  await harness?.close(BACKGROUND);
  harness = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("MVP6 Phase 0 pins: background subagents", () => {
  it("(a)(c) the child keeps running after the tool returned while the parent is idle", async () => {
    const h = await open();
    const { id } = await startThread("agent bash sleep 2", "r1");
    await untilIdle(h, id);
    const child = await untilChild(id);
    expect(await isRunning(h, id)).toBe(false);
    expect(await isRunning(h, child.id)).toBe(true);
    await untilIdle(h, child.id);
    await untilNotified(h, id);
    expect(await notificationsOf(h, id)).toHaveLength(1);
  });

  it("(b) aborting the parent does not stop the child", async () => {
    const h = await open();
    const { id } = await startThread("agent bash sleep 2", "r1");
    await untilIdle(h, id);
    const child = await untilChild(id);
    await store.send(id, { text: "bash sleep 5", requestId: "r2" }, Date.now());
    await until(() => isRunning(h, id));
    await store.abort(id);
    expect(await isRunning(h, child.id)).toBe(true);
    await untilNotified(h, id);
    const [notification] = await notificationsOf(h, id);
    expect(notification?.data).toMatchObject({ childId: child.id, status: "done" });
  });

  it("(d) a hub restart mid-child resumes the child and the reporter; one notification", async () => {
    await open();
    const { id } = await startThread("agent bash sleep 2", "r1");
    await untilIdle(harness as Harness, id);
    const child = await untilChild(id);
    const h = await restart();
    await untilNotified(h, id);
    await sleep(500);
    expect(await notificationsOf(h, id)).toHaveLength(1);
    const childUsers = (await entriesOf(h, child.id)).filter((entry) => entry.kind === "pi.user");
    expect(childUsers).toHaveLength(1);
  });
});

describe("MVP6 Phase 0 pins: migration and idempotency", () => {
  it("(e) an in-flight legacy task call replays after task gets callers: [tools]", async () => {
    await open({ legacyTask: true });
    const { id } = await startThread("task bash sleep 2", "r1");
    const child = await untilChild(id);
    await until(() => isRunning(harness as Harness, child.id));
    const h = await restart();
    await untilIdle(h, id);
    expect(await childrenOf(id)).toHaveLength(1);
    const results = (await entriesOf(h, id)).filter((entry) => entry.kind === "pi.toolResult");
    expect(JSON.stringify(results.map((entry) => entry.model))).not.toMatch(/interrupted|isError":true/);
    expect((await entriesOf(h, child.id)).filter((entry) => entry.kind === "pi.user")).toHaveLength(1);
  });

  it("(f) a rerun of the same tool call creates no second child or reporter", async () => {
    hooks.rerunSameCall = true;
    const h = await open();
    const { id } = await startThread("agent bash sleep 1", "r1");
    await untilIdle(h, id);
    await untilNotified(h, id);
    await sleep(300);
    expect(await childrenOf(id)).toHaveLength(1);
    expect(await notificationsOf(h, id)).toHaveLength(1);
  });

  it("(f) a crash between the commit and the return creates no second child after the restart", async () => {
    hooks.crashAfterCommit = true;
    await open();
    const { id } = await startThread("agent bash sleep 1", "r1");
    await untilChild(id);
    hooks.release?.();
    hooks.crashAfterCommit = false;
    const h = await restart();
    await untilNotified(h, id);
    await untilIdle(h, id);
    await sleep(300);
    expect(await childrenOf(id)).toHaveLength(1);
    expect(await notificationsOf(h, id)).toHaveLength(1);
  });

  it("(g) a restart while the notification waits in the parent's queue posts exactly one", async () => {
    await open();
    const { id } = await startThread("agent bash sleep 1", "r1");
    await untilIdle(harness as Harness, id);
    await store.send(id, { text: "bash sleep 4", requestId: "r2" }, Date.now());
    await until(async () => (await inboxOf(harness as Harness, id)).length > 0);
    expect(await inboxOf(harness as Harness, id)).toHaveLength(1);
    const h = await restart();
    await untilIdle(h, id);
    await untilNotified(h, id);
    await sleep(500);
    expect(await notificationsOf(h, id)).toHaveLength(1);
  });

  it("(g) the same notification request id is one entry", async () => {
    const h = await open();
    const { id } = await startThread("hello", "r1");
    const parent = await untilIdle(h, id);
    const data = { childId: "99", status: "done", title: "t", report: "r" };
    const notify = () =>
      parent?.submit(
        {
          type: "input",
          content: "<subagent-notification>r</subagent-notification>",
          whenBusy: "followUp",
          requestId: "subagent-report:99:x",
          entry: { kind: SUBAGENT_NOTIFICATION_KIND, data },
        },
        BACKGROUND,
      );
    await (await notify())?.wait(BACKGROUND);
    await (await notify())?.wait(BACKGROUND);
    await untilIdle(h, id);
    expect(await notificationsOf(h, id)).toHaveLength(1);
  });

  it("(h) a forked background child keeps the parent's history and reports back", async () => {
    const h = await open();
    const { id } = await startThread("hello there", "r1");
    await untilIdle(h, id);
    await store.send(id, { text: "fork_agent bash sleep 1", requestId: "r2" }, Date.now());
    const child = await untilChild(id);
    await untilNotified(h, id);
    const childText = JSON.stringify((await entriesOf(h, child.id)).map((entry) => entry.model));
    expect(childText).toContain("hello there");
    expect((await notificationsOf(h, id))[0]?.data).toMatchObject({ childId: child.id, status: "done" });
    expect(await childrenOf(id)).toHaveLength(1);
  });
});
