import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Harness } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { legacyWorkspace } from "../../harness/conversation-index";
import { type ConversationStore, createConversationStore } from "../../harness/conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "../../harness/open";
import { createAgentRegistry } from "../../harness/registry";
import { createFauxSetup } from "../../testing/faux-provider";
import { CONNECTOR_TOOL_NAME } from "../connectors/names";

const FAUX = { provider: "faux", modelId: "faux-1" };

let root: string;
let project: string;
let harness: Harness | undefined;
let store: ConversationStore;

async function startThread(text: string) {
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
    input: { text, requestId: "r1" },
    workspace: legacyWorkspace(project),
    now: Date.now(),
  });
  return summary;
}

async function entriesText(h: Harness, id: string): Promise<string> {
  const conversation = await h.conversation(Number(id) as never, BACKGROUND);
  await conversation?.waitForIdle(BACKGROUND);
  const page = await conversation?.entries({}, 200, undefined, BACKGROUND);
  return JSON.stringify(page?.items ?? []);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "tau-pin-p-")));
  project = join(root, "project");
  await mkdir(project);
  harness = await openAgentHarness({
    storage: await openSqliteStorage(join(root, "agent.sqlite")),
    models: createFauxSetup().models,
    registry: createAgentRegistry(),
  });
  store = createConversationStore(harness, async () => project);
});

afterEach(async () => {
  await harness?.close(BACKGROUND);
  harness = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("MVP10 pin (p): a claude_connector call in a thread that does not offer the tool", () => {
  it("gets an error result and the run ends, no crash", async () => {
    const { id } = await startThread(`connector Linear list_teams`);
    const text = await entriesText(harness as Harness, id);
    expect(text).toContain(CONNECTOR_TOOL_NAME);
    expect(text).toContain(`Tool ${CONNECTOR_TOOL_NAME} is not available`);
    expect(text).not.toContain("tool_error_unhandled");
  });
});
