import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConversationSummary, ConversationView, Core } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type CoreDependencies, createCoreWith, defaultCoreDependencies } from "./create-core";
import { EXECUTOR_NOT_AVAILABLE, NATIVE_BACKGROUND_REFUSED } from "./harness/tools/agent-native";
import type { NativeQueryFn } from "./runtimes/native/controller";
import { fakeQuery } from "./runtimes/native/delegation-fixture";
import { trackView, waitForAnswerAfter, waitUntil } from "./test-support/faux-core";
import { homeIn, useTempDir } from "./test-support/temp-dir";
import { NO_UPDATE_OPTIONS } from "./test-support/update-options";

const tempDir = useTempDir();
const cores: Core[] = [];

const CLAUDE_INSTALLED: Partial<CoreDependencies> = { claudeCodeInstalled: async () => true };
const CLAUDE_MISSING: Partial<CoreDependencies> = { claudeCodeInstalled: async () => false };
const DELEGATION_ON = { TAU_EXPERIMENTAL_NATIVE_DELEGATION: "1" };
const DELEGATE = "delegate it";
const POKE = "poke it";

afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close().catch(() => undefined)));
});

type Replies = Record<string, readonly object[]>;

const delegateReplies = (args: Record<string, unknown>): Replies => ({
  [DELEGATE]: [
    { tools: [{ name: "agent", arguments: { description: "look around", prompt: "go", ...args } }] },
    { text: "parent is done" },
  ],
});

async function openCore(
  root: string,
  env: Record<string, string>,
  replies: Replies,
  query: NativeQueryFn,
  installed: Partial<CoreDependencies> = {},
) {
  const repliesFile = join(root, "replies.json");
  await writeFile(repliesFile, JSON.stringify(replies));
  const core = await createCoreWith(
    { home: homeIn(root), faux: true, ...NO_UPDATE_OPTIONS },
    {
      ...defaultCoreDependencies(),
      env: { ...env, TAU_FAUX_REPLIES: repliesFile },
      ...installed,
      nativeQuery: query,
    },
  );
  cores.push(core);
  return core;
}

async function projectOf(core: Core, root: string) {
  await core.providers.setApiKey("openrouter", "sk-test");
  const [model] = await core.models.list();
  await core.settings.setDefaultModel({ provider: model?.provider ?? "", modelId: model?.modelId ?? "" });
  return core.projects.add({ path: root });
}

const toolResultsOf = (view: ConversationView | null): string =>
  (view?.entries ?? [])
    .filter((entry) => entry.kind === "pi.tool-result")
    .map((entry) => JSON.stringify(entry))
    .join("\n");

async function say(core: Core, projectId: string, text: string, existing?: ConversationSummary) {
  const parent =
    existing ?? (await core.conversations.start({ projectId, text, requestId: `s-${Math.random()}` }));
  const tracker = await trackView(core, parent.id);
  if (existing) {
    const before = tracker.view()?.entries.filter((entry) => entry.kind === "pi.assistant").length ?? 0;
    await core.conversations.send(parent.id, { text, requestId: `m-${Math.random()}` });
    await waitForAnswerAfter(tracker, before);
  } else {
    await waitForAnswerAfter(tracker, 0);
  }
  const results = toolResultsOf(tracker.view());
  await tracker.stop();
  return { parent, results };
}

const childrenOf = async (core: Core, projectId: string, parentId: string) =>
  (await core.conversations.list(projectId)).filter((thread) => thread.parentId === parentId);

describe("createCore native delegation gate", () => {
  it.each<[string, Record<string, string>, Partial<CoreDependencies>]>([
    ["Claude Code installed, delegation flag absent", {}, CLAUDE_INSTALLED],
    ["delegation flag on, Claude Code not installed", DELEGATION_ON, CLAUDE_MISSING],
    ["delegation flag not exactly 1", { TAU_EXPERIMENTAL_NATIVE_DELEGATION: "true" }, CLAUDE_INSTALLED],
  ])("refuses an executor call before any side effect: %s", async (_name, env, installed) => {
    const root = await tempDir();
    const counted = fakeQuery({ text: "must not run" });
    const core = await openCore(
      root,
      env,
      delegateReplies({ executor: "claude-code" }),
      counted.query,
      installed,
    );
    const project = await projectOf(core, root);

    const { parent, results } = await say(core, project.id, DELEGATE);

    expect(results).toContain(EXECUTOR_NOT_AVAILABLE);
    expect(await childrenOf(core, project.id, parent.id)).toEqual([]);
    expect(counted.runs()).toBe(0);
  });

  it("refuses background and Pi-only options with the native executor before any side effect", async () => {
    const root = await tempDir();
    const counted = fakeQuery({ text: "must not run" });
    const core = await openCore(
      root,
      DELEGATION_ON,
      delegateReplies({ executor: "claude-code", run_in_background: true }),
      counted.query,
      CLAUDE_INSTALLED,
    );
    const project = await projectOf(core, root);

    const { parent, results } = await say(core, project.id, DELEGATE);

    expect(results).toContain(NATIVE_BACKGROUND_REFUSED);
    expect(await childrenOf(core, project.id, parent.id)).toEqual([]);
    expect(counted.runs()).toBe(0);
  });
});

describe("createCore native delegation", () => {
  it("runs a native child for a Pi parent, awaits its report and shows it under the parent", async () => {
    const root = await tempDir();
    const counted = fakeQuery({ text: "native report" });
    const core = await openCore(
      root,
      DELEGATION_ON,
      delegateReplies({ executor: "claude-code" }),
      counted.query,
      CLAUDE_INSTALLED,
    );
    const project = await projectOf(core, root);

    const { parent, results } = await say(core, project.id, DELEGATE);

    const [child] = await childrenOf(core, project.id, parent.id);
    expect(results).toContain("native report");
    expect(counted.runs()).toBe(1);
    expect(child).toMatchObject({
      executor: "claude-code",
      title: "look around",
      agentType: "claude-code",
      agentStatus: "done",
      parentId: parent.id,
    });
  });

  it("removes the running native child with its parent and stops its run", async () => {
    const root = await tempDir();
    let closed = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = fakeQuery({ text: "never", hold: held });
    const query: NativeQueryFn = (args) => {
      const stream = inner.query(args);
      const innerClose = stream.close?.bind(stream);
      return Object.assign(stream, {
        close: () => {
          closed = true;
          innerClose?.();
        },
      });
    };
    const core = await openCore(
      root,
      DELEGATION_ON,
      delegateReplies({ executor: "claude-code" }),
      query,
      CLAUDE_INSTALLED,
    );
    const project = await projectOf(core, root);
    const parent = await core.conversations.start({
      projectId: project.id,
      text: DELEGATE,
      requestId: "s-1",
    });
    await waitUntil(() => inner.runs() === 1, "the child run");
    expect(await childrenOf(core, project.id, parent.id)).toHaveLength(1);

    await core.conversations.remove(parent.id, { force: true });
    release();

    expect(await core.conversations.list(project.id)).toEqual([]);
    expect(closed).toBe(true);
  });

  it("keeps the child across a restart and refuses subagent tools that would hand it to Pi", async () => {
    const root = await tempDir();
    const counted = fakeQuery({ text: "native report" });
    const first = await openCore(
      root,
      DELEGATION_ON,
      delegateReplies({ executor: "claude-code" }),
      counted.query,
      CLAUDE_INSTALLED,
    );
    const project = await projectOf(first, root);
    const { parent } = await say(first, project.id, DELEGATE);
    const [child] = await childrenOf(first, project.id, parent.id);
    await first.close();
    cores.splice(cores.indexOf(first), 1);

    const replies: Replies = {
      ...delegateReplies({ executor: "claude-code" }),
      [POKE]: [
        { tools: [{ name: "send_message", arguments: { to: child?.id, message: "hi" } }] },
        { text: "poked" },
      ],
    };
    const second = await openCore(root, DELEGATION_ON, replies, counted.query, CLAUDE_INSTALLED);
    const { results } = await say(second, project.id, POKE, parent);

    expect(results).toContain("is a native Claude child");
    expect(counted.runs()).toBe(1);
    expect(await childrenOf(second, project.id, parent.id)).toHaveLength(1);
  });
});
