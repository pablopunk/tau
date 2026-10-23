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

interface Counted {
  readonly query: NativeQueryFn;
  readonly runs: () => number;
}

function countedAnswer(): Counted {
  let runs = 0;
  return {
    runs: () => runs,
    query: () => {
      runs += 1;
      const uuid = `run-${runs}`;
      return (async function* () {
        yield { type: "system", subtype: "init", session_id: "core-session", uuid: `${uuid}-init` };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "core-session",
          uuid: `${uuid}-result`,
        };
      })();
    },
  };
}

const startNativeOf = (core: Core) =>
  (core.conversations as { startNative?: (input: unknown) => Promise<ConversationSummary> }).startNative;

async function openCore(
  root: string,
  env: Record<string, string>,
  nativeQuery?: NativeQueryFn,
  installed: Partial<CoreDependencies> = {},
) {
  const core = await createCoreWith(
    { home: homeIn(root), faux: true, ...NO_UPDATE_OPTIONS },
    { ...defaultCoreDependencies(), env, ...installed, ...(nativeQuery && { nativeQuery }) },
  );
  cores.push(core);
  return core;
}

const finishedRun = async (core: Core, projectId: string, id: string) =>
  waitFor(async () => {
    const found = (await core.conversations.list(projectId)).find((thread) => thread.id === id);
    return found === undefined || found.lastRunEndedAt === null ? undefined : found;
  }, "the native run to end");

const executorsOf = async (core: Core) =>
  Object.fromEntries((await core.runtimes.list()).executors.map((entry) => [entry.executor, entry]));

describe("createCore wire start and runtimes.list", () => {
  it("lists claude-code disabled with a reason when Claude Code is not installed", async () => {
    const core = await openCore(await tempDir(), {}, countedAnswer().query);

    const executors = await executorsOf(core);

    expect(Object.keys(executors)).toEqual(["pi", "claude-code"]);
    expect(executors.pi).toMatchObject({ enabled: true });
    expect(executors["claude-code"]).toMatchObject({
      enabled: false,
      reason: "Claude Code is not installed on this node",
    });
    expect(executors["claude-code"]?.capabilities.followUp).toEqual({
      supported: false,
      reason: "executor-disabled",
    });
  });

  it("lists claude-code enabled with the native capabilities when Claude Code is installed", async () => {
    const core = await openCore(await tempDir(), {}, countedAnswer().query, CLAUDE_INSTALLED);

    const executors = await executorsOf(core);

    expect(executors["claude-code"]).toMatchObject({ enabled: true });
    expect(executors["claude-code"]?.capabilities.followUp).toEqual({ supported: true });
    expect(executors["claude-code"]?.capabilities.steer.supported).toBe(false);
    expect(executors["claude-code"]?.reason).toBeUndefined();
  });

  it("refuses a claude-code start without Claude Code and never starts a Pi thread instead", async () => {
    const root = await tempDir();
    const counted = countedAnswer();
    const core = await openCore(root, {}, counted.query);
    await core.providers.setApiKey("openrouter", "sk-test");
    await core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" });
    const project = await core.projects.add({ path: root });

    await expect(
      core.conversations.start({
        projectId: project.id,
        text: "hello",
        requestId: "w-1",
        executor: "claude-code",
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "Claude Code is not installed on this node",
    });

    expect(await core.conversations.list(project.id)).toEqual([]);
    expect(counted.runs()).toBe(0);
  });

  it("starts a native thread from conversations.start with Claude Code installed, and Pi when the executor is omitted or pi", async () => {
    const root = await tempDir();
    const counted = countedAnswer();
    const core = await openCore(root, {}, counted.query, CLAUDE_INSTALLED);
    await core.providers.setApiKey("openrouter", "sk-test");
    await core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" });
    const project = await core.projects.add({ path: root });

    const native = await core.conversations.start({
      projectId: project.id,
      text: "hello native",
      requestId: "w-1",
      executor: "claude-code",
    });
    await finishedRun(core, project.id, native.id);
    const omitted = await core.conversations.start({
      projectId: project.id,
      text: "pi one",
      requestId: "w-2",
    });
    const explicit = await core.conversations.start({
      projectId: project.id,
      text: "pi two",
      requestId: "w-3",
      executor: "pi",
    });

    expect(native).toMatchObject({ executor: "claude-code", model: null });
    expect(counted.runs()).toBe(1);
    for (const pi of [omitted, explicit]) {
      expect(pi.executor).toBeUndefined();
      expect(pi.model).not.toBeNull();
    }
  });
});

interface Recording {
  readonly query: NativeQueryFn;
  readonly options: () => readonly Record<string, unknown>[];
}

function recordingAnswer(): Recording {
  const captured: Record<string, unknown>[] = [];
  const counted = countedAnswer();
  const query: NativeQueryFn = (input) => {
    captured.push(input.options);
    return counted.query(input);
  };
  return { query, options: () => captured };
}

const CLAUDE_MODEL = { provider: "claude-cli", modelId: "claude-opus-4-6" };

describe("createCore and the model of a native thread", () => {
  it("routes new Claude models to native but keeps explicit legacy Pi starts and sends on Pi", async () => {
    const root = await tempDir();
    const recording = recordingAnswer();
    const core = await openCore(root, { TAU_FAKE_CLAUDE_CLI: "1" }, recording.query, CLAUDE_INSTALLED);
    await core.providers.acknowledgeClaudeCli();
    const model = (await core.models.list()).find((entry) => entry.provider === "claude-cli");
    if (!model) throw new Error("Missing fake Claude model");
    const ref = { provider: model.provider, modelId: model.modelId };
    const project = await core.projects.add({ path: root });
    const legacy = await core.conversations.start({
      projectId: project.id,
      text: "hello legacy",
      requestId: "legacy",
      model: ref,
      executor: "pi",
    });
    expect(legacy.executor).toBeUndefined();
    await core.conversations.send(legacy.id, { text: "legacy follow-up", requestId: "legacy-send" });
    expect(recording.options()).toEqual([]);
    const native = await core.conversations.start({
      projectId: project.id,
      text: "hello native",
      requestId: "automatic",
      model: ref,
    });
    expect(native).toMatchObject({ executor: "claude-code", model: ref });
    await finishedRun(core, project.id, native.id);
    expect(recording.options()[0]).toMatchObject({ model: ref.modelId });
  });

  it("runs the chosen claude-cli model, reports it, and keeps it for follow-ups and after a reopen", async () => {
    const root = await tempDir();
    const recording = recordingAnswer();
    const first = await openCore(root, {}, recording.query, CLAUDE_INSTALLED);
    const project = await first.projects.add({ path: root });

    const native = await first.conversations.start({
      projectId: project.id,
      text: "hello native",
      requestId: "m-1",
      executor: "claude-code",
      model: CLAUDE_MODEL,
    });
    await finishedRun(first, project.id, native.id);

    expect(native.model).toEqual(CLAUDE_MODEL);
    expect(recording.options()[0]).toMatchObject({ model: CLAUDE_MODEL.modelId });
    await first.conversations.send(native.id, { text: "again", requestId: "m-2" });
    await waitFor(async () => (recording.options().length === 2 ? true : undefined), "the follow-up run");
    expect(recording.options()[1]).toMatchObject({ model: CLAUDE_MODEL.modelId });

    await first.close();
    const reopened = await openCore(root, {}, recording.query, CLAUDE_INSTALLED);
    const [listed] = await reopened.conversations.list(project.id);
    expect(listed?.model).toEqual(CLAUDE_MODEL);
    await reopened.conversations.send(native.id, { text: "after restart", requestId: "m-3" });
    await waitFor(async () => (recording.options().length === 3 ? true : undefined), "the run after reopen");
    expect(recording.options()[2]).toMatchObject({ model: CLAUDE_MODEL.modelId });
  });

  it("refuses a native start with a model of another provider and creates nothing", async () => {
    const root = await tempDir();
    const recording = recordingAnswer();
    const core = await openCore(root, {}, recording.query, CLAUDE_INSTALLED);
    const project = await core.projects.add({ path: root });

    await expect(
      core.conversations.start({
        projectId: project.id,
        text: "hello",
        requestId: "m-1",
        executor: "claude-code",
        model: { provider: "faux", modelId: "faux-1" },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    expect(await core.conversations.list(project.id)).toEqual([]);
    expect(recording.options()).toEqual([]);
  });

  it("starts without a model option and a null summary model when none is chosen", async () => {
    const root = await tempDir();
    const recording = recordingAnswer();
    const core = await openCore(root, {}, recording.query, CLAUDE_INSTALLED);
    const project = await core.projects.add({ path: root });

    const native = await core.conversations.start({
      projectId: project.id,
      text: "hello native",
      requestId: "m-1",
      executor: "claude-code",
    });
    await finishedRun(core, project.id, native.id);

    expect(native.model).toBeNull();
    expect("model" in (recording.options()[0] ?? {})).toBe(false);
  });
});

interface Asking {
  readonly query: NativeQueryFn;
  readonly options: () => Record<string, unknown> | undefined;
  readonly answer: () => Promise<unknown>;
}

function askingForBash(): Asking {
  let captured: Record<string, unknown> | undefined;
  let answer: Promise<unknown> = Promise.resolve(undefined);
  const query: NativeQueryFn = ({ options }) => {
    captured = options;
    const canUseTool = options.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      extra: { signal: AbortSignal; toolUseID: string },
    ) => Promise<unknown>;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "ask-session", uuid: "ask-init" };
      answer = canUseTool(
        "Bash",
        { command: "touch made.txt" },
        { signal: new AbortController().signal, toolUseID: "toolu_core_1" },
      );
      await answer;
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ok",
        session_id: "ask-session",
        uuid: "ask-result",
      };
    })();
  };
  return { query, options: () => captured, answer: () => answer };
}

describe("createCore and native permissions", () => {
  it("runs native threads with Claude Code's tools and asks through the core approvals", async () => {
    const root = await tempDir();
    const asking = askingForBash();
    const core = await openCore(root, {}, asking.query, CLAUDE_INSTALLED);
    const project = await core.projects.add({ path: root });

    const native = await startNativeOf(core)?.({ projectId: project.id, text: "touch it", requestId: "a-1" });
    const id = native?.id ?? "";
    const waiting = await waitFor(async () => {
      const list = await core.approvals.list(id);
      return list.length === 1 ? list : undefined;
    }, "the native approval");

    expect(asking.options()).toMatchObject({
      tools: { type: "preset", preset: "claude_code" },
      permissionMode: "default",
      settingSources: ["user", "project", "local"],
    });
    expect(waiting).toMatchObject([{ toolUseId: "toolu_core_1", conversationId: id, tool: "Bash" }]);
    await core.approvals.decide(id, "toolu_core_1", "deny");
    expect(await asking.answer()).toMatchObject({ behavior: "deny" });
    await finishedRun(core, project.id, id);
    expect(await core.approvals.list(id)).toEqual([]);
  });

  it("denies the waiting approval when the native thread is removed", async () => {
    const root = await tempDir();
    const asking = askingForBash();
    const core = await openCore(root, {}, asking.query, CLAUDE_INSTALLED);
    const project = await core.projects.add({ path: root });
    const native = await startNativeOf(core)?.({ projectId: project.id, text: "touch it", requestId: "a-1" });
    const id = native?.id ?? "";
    await waitFor(
      async () => ((await core.approvals.list(id)).length === 1 ? true : undefined),
      "the approval",
    );

    await core.conversations.remove(id, { force: true });

    expect(await asking.answer()).toMatchObject({ behavior: "deny" });
    expect(await core.approvals.list(id).catch(() => [])).toEqual([]);
  });
});

describe("createCore and Claude Code installation", () => {
  it("keeps native unreachable when claudeCodeInstalled resolves false", async () => {
    const core = await openCore(await tempDir(), {}, countedAnswer().query, {
      claudeCodeInstalled: async () => false,
    });

    expect(startNativeOf(core)).toBeUndefined();
  });

  it("starts, runs and sends to a native thread when Claude Code is installed, beside an untouched Pi thread", async () => {
    const root = await tempDir();
    const counted = countedAnswer();
    const core = await openCore(root, {}, counted.query, CLAUDE_INSTALLED);
    await core.providers.setApiKey("openrouter", "sk-test");
    await core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" });
    const project = await core.projects.add({ path: root });

    const native = await startNativeOf(core)?.({
      projectId: project.id,
      text: "hello native",
      requestId: "n-1",
    });
    const finished = await finishedRun(core, project.id, native?.id ?? "");
    await core.conversations.send(native?.id ?? "", { text: "again", requestId: "n-2" });
    await waitFor(async () => (counted.runs() === 2 ? true : undefined), "the second native run");

    expect(native).toMatchObject({ executor: "claude-code", model: null });
    expect(finished.status).toBe("idle");
    await expect(core.conversations.retry(native?.id ?? "", { requestId: "r" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    const pi = await core.conversations.start({ projectId: project.id, text: "hello pi", requestId: "pi-1" });
    expect(pi.executor).toBeUndefined();
    expect(pi.model).not.toBeNull();
  });

  it("keeps a native thread across a restart and never relaunches it", async () => {
    const root = await tempDir();
    const first = countedAnswer();
    const core = await openCore(root, {}, first.query, CLAUDE_INSTALLED);
    const project = await core.projects.add({ path: root });
    const native = await startNativeOf(core)?.({
      projectId: project.id,
      text: "persist me",
      requestId: "n-1",
    });
    await finishedRun(core, project.id, native?.id ?? "");
    await core.close();
    cores.splice(cores.indexOf(core), 1);

    const second = countedAnswer();
    const restarted = await openCore(root, {}, second.query, CLAUDE_INSTALLED);
    await sleep(300);

    const listed = (await restarted.conversations.list(project.id)).find(
      (thread) => thread.id === native?.id,
    );
    expect(listed).toMatchObject({ executor: "claude-code", title: "persist me", status: "idle" });
    expect(second.runs()).toBe(0);
  });
});
