import type { ConversationSummary, Core } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createCoreWith, defaultCoreDependencies } from "./create-core";
import type { NativeQueryFn } from "./runtimes/native/controller";
import { homeIn, useTempDir } from "./test-support/temp-dir";
import { NO_UPDATE_OPTIONS } from "./test-support/update-options";

const tempDir = useTempDir();
const cores: Core[] = [];
const FLAG_ON = { TAU_EXPERIMENTAL_NATIVE_CLAUDE: "1" };

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

async function openCore(root: string, env: Record<string, string>, nativeQuery?: NativeQueryFn) {
  const core = await createCoreWith(
    { home: homeIn(root), faux: true, ...NO_UPDATE_OPTIONS },
    { ...defaultCoreDependencies(), env, ...(nativeQuery && { nativeQuery }) },
  );
  cores.push(core);
  return core;
}

const finishedRun = async (core: Core, projectId: string, id: string) =>
  waitFor(async () => {
    const found = (await core.conversations.list(projectId)).find((thread) => thread.id === id);
    return found === undefined || found.lastRunEndedAt === null ? undefined : found;
  }, "the native run to end");

describe("createCore and the native flag", () => {
  it.each<Record<string, string>>([
    {},
    { TAU_EXPERIMENTAL_NATIVE_CLAUDE: "0" },
    { TAU_EXPERIMENTAL_NATIVE_CLAUDE: "true" },
  ])("keeps native unreachable unless the flag is exactly 1 (%j)", async (env) => {
    const core = await openCore(await tempDir(), env, countedAnswer().query);

    expect(startNativeOf(core)).toBeUndefined();
  });

  it("starts, runs and sends to a native thread when the flag is on, beside an untouched Pi thread", async () => {
    const root = await tempDir();
    const counted = countedAnswer();
    const core = await openCore(root, FLAG_ON, counted.query);
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
    const core = await openCore(root, FLAG_ON, first.query);
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
    const restarted = await openCore(root, FLAG_ON, second.query);
    await sleep(300);

    const listed = (await restarted.conversations.list(project.id)).find(
      (thread) => thread.id === native?.id,
    );
    expect(listed).toMatchObject({ executor: "claude-code", title: "persist me", status: "idle" });
    expect(second.runs()).toBe(0);
  });
});
