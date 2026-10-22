import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBinding } from "./binding";
import type { BindingSnapshot } from "./binding-store";
import type { ClaudeCliStreamDeps } from "./claude-cli-stream";
import { createRuntime, type Runtime } from "./runtime";
import { ask, createHarness, systemMessage, userMessage } from "./test-support";

const writes = vi.hoisted(() => ({ delaysMs: [] as number[], started: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      writes.started += 1;
      const delay = writes.delaysMs.shift() ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      return actual.writeFile(...args);
    },
  };
});

const snapshotOf = (sdkSessionId: string): BindingSnapshot => ({
  sdkSessionId,
  checkpoints: [],
  head: null,
  created: [sdkSessionId],
  model: "haiku",
});

const boundTo = (id: string, sdkSessionId: string) => {
  const binding = createBinding(id, "haiku");
  binding.sdkSessionId = sdkSessionId;
  return binding;
};

const readSaved = async (file: string): Promise<Record<string, BindingSnapshot>> =>
  JSON.parse(await readFile(file, "utf8"));

let dir = "";
let file = "";

function runtimeFor(onPersistError?: (error: unknown) => void, bindingsFile = file): Runtime {
  return createRuntime({ bindingsFile, onPersistError } as unknown as ClaudeCliStreamDeps);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tau-runtime-"));
  file = join(dir, "bindings.json");
  writes.delaysMs = [];
  writes.started = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("persisted bindings", () => {
  it("two cold persists keep the file's old rows and both new rows", async () => {
    await writeFile(file, JSON.stringify({ old: snapshotOf("s-old") }), "utf8");
    const rt = runtimeFor();
    rt.persistBinding(boundTo("a", "s-a"));
    rt.persistBinding(boundTo("b", "s-b"));
    await rt.flush();
    expect(Object.keys(await readSaved(file)).sort()).toEqual(["a", "b", "old"]);
  });

  it("overlapping saves end with the last state, even when the first write is slow", async () => {
    const rt = runtimeFor();
    const binding = boundTo("a", "v1");
    writes.delaysMs = [60];
    rt.persistBinding(binding);
    await vi.waitFor(() => expect(writes.started).toBe(1));
    binding.sdkSessionId = "v2";
    rt.persistBinding(binding);
    await rt.flush();
    expect((await readSaved(file)).a?.sdkSessionId).toBe("v2");
  });

  it("a failed save reports the error and neither throws nor blocks the flush", async () => {
    const onPersistError = vi.fn();
    const rt = runtimeFor(onPersistError, join(dir, "missing", "bindings.json"));
    rt.persistBinding(boundTo("a", "s-a"));
    await expect(rt.flush()).resolves.toBeUndefined();
    expect(onPersistError).toHaveBeenCalledTimes(1);
    expect(onPersistError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("two concurrent restores of one session share one binding", async () => {
    await writeFile(file, JSON.stringify({ s1: snapshotOf("s-1") }), "utf8");
    const rt = runtimeFor();
    const [first, second] = await Promise.all([rt.restoreBinding("s1"), rt.restoreBinding("s1")]);
    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(rt.bindings.get("s1")).toBe(first);
  });

  it("closeAll resolves only after the pending save reached the file", async () => {
    const harness = createHarness({ bindingsFile: file });
    writes.delaysMs = Array(10).fill(40);
    await ask(harness, [systemMessage(), userMessage("a")]);
    await harness.streamer.closeAll();
    const saved = (await readSaved(file))["thread-1"];
    expect(saved?.sdkSessionId).toBe(harness.fake.queries[0]?.sessionId);
    expect(saved?.checkpoints).toHaveLength(1);
  });
});
