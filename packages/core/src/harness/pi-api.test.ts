import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyImmutable, type Op } from "@earendil-works/chord/delta";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider, personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";
import {
  type ConversationView,
  defineDoc,
  defineDocFamily,
  type Harness,
  type InboxState,
  type LiveState,
} from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFauxSetup } from "../testing/faux-provider";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./open";
import { createAgentRegistry } from "./registry";

const Projects = defineDoc<{ projects: { id: string; name: string }[] }>({
  kind: "app.projects",
  version: 1,
  scope: "session",
  initial: () => ({ projects: [] }),
});

const ProjectIndex = defineDocFamily<{ conversations: { conversationId: number; title: string }[] }, null>({
  kind: "app.project-index",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ conversations: [] }),
});

const ConversationMeta = defineDoc<{ projectId: string; title: string }>({
  kind: "app.conversation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ projectId: "", title: "" }),
});

const faux = { provider: "faux", modelId: "faux-1" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let root: string;
let project: string;
let harness: Harness | undefined;

async function open(): Promise<Harness> {
  const storage = await openSqliteStorage(join(root, "agent.sqlite"));
  harness = await openAgentHarness({
    storage,
    models: createFauxSetup().models,
    registry: createAgentRegistry(),
  });
  return harness;
}

async function createTracked(h: Harness) {
  return h.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { model: faux, cwd: project },
      init: async (tx, conversationId) => {
        (await tx.doc(ConversationMeta, conversationId)).title = "first";
        (await tx.doc(ConversationMeta, conversationId)).projectId = "p1";
        (await tx.doc(ProjectIndex, "p1", null)).conversations.push({
          conversationId: Number(conversationId),
          title: "first",
        });
        (await tx.doc(Projects)).projects.push({ id: "p1", name: "Project" });
      },
    },
    BACKGROUND,
  );
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pie-pi-api-")));
  project = join(root, "project");
  await mkdir(project);
});

afterEach(async () => {
  await harness?.close(BACKGROUND);
  harness = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("pi-durable API we use", () => {
  it("creates a conversation and its app documents in one commit", async () => {
    const h = await open();
    const conversation = await createTracked(h);
    expect(await h.snapshot(ConversationMeta, conversation.id, BACKGROUND)).toMatchObject({
      projectId: "p1",
      title: "first",
    });
    expect((await h.snapshot(ProjectIndex, "p1", BACKGROUND))?.conversations).toHaveLength(1);
    expect((await h.snapshot(Projects, BACKGROUND))?.projects).toEqual([{ id: "p1", name: "Project" }]);
    const page = await h.commit((tx) => tx.scanConversations({}, 10), BACKGROUND);
    expect(page.items.map((item) => item.id)).toContain(conversation.id);
  });

  it("runs a tool in the project folder and answers", async () => {
    const h = await open();
    const conversation = await createTracked(h);
    const submission = await conversation.submit(
      { type: "input", content: "write hello.txt hi there" },
      BACKGROUND,
    );
    expect((await submission.wait(BACKGROUND)).status).toBe("done");
    expect(await readFile(join(project, "hello.txt"), "utf8")).toBe("hi there");
  });

  it("watches a conversation with exact ops that rebuild the view", async () => {
    const h = await open();
    const conversation = await createTracked(h);
    const watch = await conversation.watch(BACKGROUND);
    let view: ConversationView = watch.value;
    watch.start(async (_value, ops: readonly Op[]) => {
      view = applyImmutable<ConversationView>(view, ops);
    });
    await (await conversation.submit({ type: "input", content: "hello" }, BACKGROUND)).wait(BACKGROUND);
    await conversation.waitForIdle(BACKGROUND);
    await sleep(100);
    const kinds = view.entries.map((entry) => entry.kind);
    expect(kinds).toContain("pi.user");
    expect(kinds).toContain("pi.assistant");
    expect(view.docs["pi.live"]).toEqual({});
    await watch.stop();
  });

  it("queues a steer in the inbox while busy, and aborts", async () => {
    const h = await open();
    const conversation = await createTracked(h);
    await conversation.submit({ type: "input", content: "bash sleep 5" }, BACKGROUND);
    await sleep(500);
    await conversation.submit({ type: "input", content: "write a.txt a", whenBusy: "steer" }, BACKGROUND);
    const view = await conversation.viewState(BACKGROUND);
    const inbox = view.value.docs["pi.inbox"] as InboxState;
    expect(inbox.items).toHaveLength(1);
    expect((view.value.docs["pi.live"] as LiveState).run).toBeDefined();
    view.dispose();
    await conversation.abort(BACKGROUND);
    const after = await conversation.viewState(BACKGROUND);
    expect((after.value.docs["pi.live"] as LiveState).run).toBeUndefined();
    after.dispose();
  });

  it("notifies commit subscribers and reports a closed session", async () => {
    const h = await open();
    let commits = 0;
    const stop = h.subscribeCommits(() => {
      commits++;
    });
    await createTracked(h);
    expect(commits).toBeGreaterThan(0);
    stop();
    await h.close(BACKGROUND);
    expect(await h.closed).toEqual({ reason: "closed" });
  });

  it("keeps conversations across a restart", async () => {
    const first = await open();
    const conversation = await createTracked(first);
    await (await conversation.submit({ type: "input", content: "hello" }, BACKGROUND)).wait(BACKGROUND);
    await first.close(BACKGROUND);
    const second = await open();
    const again = await second.conversation(conversation.id, BACKGROUND);
    const entries = await again?.entries({}, 10, undefined, BACKGROUND);
    expect(entries?.items.length).toBeGreaterThan(1);
  });
});

describe("pi-ai API we use", () => {
  it("lists the bundled OpenRouter catalog", () => {
    const models = createModels({ credentials: new InMemoryCredentialStore() });
    models.setProvider(openrouterProvider());
    expect(models.getModels("openrouter").length).toBeGreaterThan(10);
    expect(typeof personalizeOpenRouterCatalog).toBe("function");
  });

  it("resolves the key from a stored credential or from OPENROUTER_API_KEY", async () => {
    const credentials = new InMemoryCredentialStore();
    const env: Record<string, string> = {};
    const models = createModels({
      credentials,
      authContext: { env: async (name) => env[name], fileExists: async () => false },
    });
    models.setProvider(openrouterProvider());
    expect(await models.getAuth("openrouter")).toBeUndefined();
    env.OPENROUTER_API_KEY = "sk-env";
    expect((await models.getAuth("openrouter"))?.auth.apiKey).toBe("sk-env");
    delete env.OPENROUTER_API_KEY;
    await credentials.modify("openrouter", async () => ({ type: "api_key", key: "sk-file" }));
    expect((await models.getAuth("openrouter"))?.auth.apiKey).toBe("sk-file");
  });
});
