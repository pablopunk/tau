import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Conversation, ConversationId, Harness, PromptInput } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFauxSetup } from "../../testing/faux-provider";
import { legacyWorkspace } from "../conversation-index";
import { type ConversationStore, createConversationStore } from "../conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "../open";
import { createAgentRegistry, LEGACY_TOOL_FILES } from "../registry";
import { renderSubagentsSection } from "../subagents-prompt";
import { notMyChildMessage } from "./task-child";

const FAUX = { provider: "faux", modelId: "faux-1" };

let root: string;
let project: string;
let harness: Harness | undefined;
let store: ConversationStore;

async function open() {
  harness = await openAgentHarness({
    storage: await openSqliteStorage(join(root, "agent.sqlite")),
    models: createFauxSetup().models,
    registry: createAgentRegistry(undefined, LEGACY_TOOL_FILES),
  });
  store = createConversationStore(harness, async () => project);
  return harness;
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

async function untilIdle(h: Harness, id: string) {
  const conversation = await h.conversation(Number(id) as never, BACKGROUND);
  await conversation?.waitForIdle(BACKGROUND);
  return conversation as Conversation;
}

async function childrenOf(parentId: string) {
  return (await store.list("p1")).filter((thread) => thread.parentId === parentId);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "task-continue-")));
  project = join(root, "project");
  await mkdir(project);
});

afterEach(async () => {
  await harness?.close(BACKGROUND);
  harness = undefined;
  await rm(root, { recursive: true, force: true });
});

async function assistantTexts(h: Harness, id: string): Promise<string> {
  const child = await untilIdle(h, id);
  const page = await child.commit(
    (tx) => tx.scanEntries({ conversationId: Number(id) as never }, 50),
    BACKGROUND,
  );
  return JSON.stringify(page.items.map((entry) => entry.model));
}

async function promptFor(h: Harness, id: string) {
  const input = {
    conversationId: Number(id),
    read: { snapshot: (doc: never, ...rest: never[]) => (h.snapshot as Function)(doc, ...rest) },
  } as unknown as PromptInput;
  return renderSubagentsSection(input, BACKGROUND);
}

describe("persistent subagents", () => {
  it("lists children with id, title and status in the parent prompt", async () => {
    const h = await open();
    const { id } = await startThread("task look around", "r1");
    await untilIdle(h, id);
    const [child] = await childrenOf(id);
    const prompt = await promptFor(h, id);
    expect(prompt).toContain("persistent threads the user can open from the sidebar");
    expect(prompt).toContain(`id ${child?.id}: look around (`);
    expect(prompt).toMatch(/\((idle|running|failed), last activity/);
  });

  it("has no subagents section without children", async () => {
    const h = await open();
    const { id } = await startThread("hello", "r1");
    await untilIdle(h, id);
    expect(await promptFor(h, id)).toBeUndefined();
  });

  it("continues an existing child with a new message and returns its answer", async () => {
    const h = await open();
    const { id } = await startThread("task first job", "r1");
    const conversation = await untilIdle(h, id);
    const [child] = await childrenOf(id);
    await store.send(id, { text: `continue ${child?.id} second ask`, requestId: "r2" }, Date.now());
    await conversation.waitForIdle(BACKGROUND);
    expect(await childrenOf(id)).toHaveLength(1);
    const texts = await assistantTexts(h, child?.id as string);
    expect(texts).toContain("second ask");
    expect(texts).toContain("first job");
  });

  it("rejects an id that is not a child of this thread", async () => {
    const h = await open();
    const { id } = await startThread("task first job", "r1");
    const conversation = await untilIdle(h, id);
    await store.send(id, { text: "continue 99999 nope", requestId: "r2" }, Date.now());
    await conversation.waitForIdle(BACKGROUND);
    const page = await conversation.commit(
      (tx) => tx.scanEntries({ conversationId: Number(id) as never }, 50),
      BACKGROUND,
    );
    expect(JSON.stringify(page.items)).toContain(notMyChildMessage("99999"));
    expect(await childrenOf(id)).toHaveLength(1);
  });
});
