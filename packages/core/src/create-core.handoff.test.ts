import type { ConversationSummary, Core } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type CoreDependencies, createCoreWith, defaultCoreDependencies } from "./create-core";
import type { NativeQueryFn } from "./runtimes/native/controller";
import { homeIn, useTempDir } from "./test-support/temp-dir";
import { NO_UPDATE_OPTIONS } from "./test-support/update-options";

const tempDir = useTempDir();
const cores: Core[] = [];
const CLAUDE_INSTALLED: Partial<CoreDependencies> = { claudeCodeInstalled: async () => true };

afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close()));
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

function recordingAnswer() {
  const prompts: string[] = [];
  const query: NativeQueryFn = ({ prompt }) => {
    prompts.push(prompt);
    const uuid = `run-${prompts.length}`;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "handoff-core", uuid: `${uuid}-init` };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ok",
        session_id: "handoff-core",
        uuid: `${uuid}-result`,
      };
    })();
  };
  return { query, prompts };
}

async function openCore(
  root: string,
  env: Record<string, string>,
  nativeQuery: NativeQueryFn,
  installed: Partial<CoreDependencies> = {},
) {
  const core = await createCoreWith(
    { home: homeIn(root), faux: true, ...NO_UPDATE_OPTIONS },
    { ...defaultCoreDependencies(), env, ...installed, nativeQuery },
  );
  cores.push(core);
  return core;
}

async function idlePiThread(core: Core, root: string) {
  await core.providers.setApiKey("openrouter", "sk-test");
  await core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" });
  const project = await core.projects.add({ path: root });
  const started = await core.conversations.start({
    projectId: project.id,
    text: "plan the migration",
    requestId: "pi-1",
    workspace: "checkout",
  });
  const idle = await waitFor(async () => {
    const found = (await core.conversations.list(project.id)).find((thread) => thread.id === started.id);
    return found?.status === "idle" && found.lastRunEndedAt !== null ? found : undefined;
  }, "the Pi run to end");
  return { project, source: idle };
}

const threadsOf = async (core: Core, projectId: string): Promise<ConversationSummary[]> =>
  core.conversations.list(projectId);

describe("createCore handoff", () => {
  it("hands an idle Pi thread off to a new native thread when Claude Code is installed", async () => {
    const root = await tempDir();
    const answering = recordingAnswer();
    const core = await openCore(root, {}, answering.query, CLAUDE_INSTALLED);
    const { project, source } = await idlePiThread(core, root);

    const preview = await core.conversations.handoffPreview(source.id);
    const created = await core.conversations.handoff(source.id, { requestId: "h-1", instruction: "Go on" });
    await waitFor(
      async () => (answering.prompts.length === 1 ? true : undefined),
      "the native first message",
    );

    expect(preview.canHandoff).toBe(true);
    expect(preview.preview).toContain("User: plan the migration");
    expect(created).toMatchObject({ executor: "claude-code", model: null, projectId: project.id });
    expect(created.forkOf?.conversationId).toBe(source.id);
    expect(created.workspace.path).toBe(source.workspace.path);
    expect(answering.prompts[0]).toContain("User: plan the migration");
    expect(answering.prompts[0]?.endsWith("Task: Go on")).toBe(true);
    expect((await core.conversations.handoff(source.id, { requestId: "h-1" })).id).toBe(created.id);
    expect(await threadsOf(core, project.id)).toHaveLength(2);
    expect(answering.prompts).toHaveLength(1);
  });

  it("refuses while Claude Code is not installed, with the node-level reason and no new thread", async () => {
    const root = await tempDir();
    const answering = recordingAnswer();
    const core = await openCore(root, {}, answering.query);
    const { project, source } = await idlePiThread(core, root);

    const preview = await core.conversations.handoffPreview(source.id);
    await expect(core.conversations.handoff(source.id, { requestId: "h-1" })).rejects.toMatchObject({
      code: "invalid_request",
      message: "Claude Code is not installed on this node",
    });

    expect(preview).toMatchObject({ canHandoff: false, reason: "Claude Code is not installed on this node" });
    expect(await threadsOf(core, project.id)).toHaveLength(1);
    expect(answering.prompts).toEqual([]);
  });
});
