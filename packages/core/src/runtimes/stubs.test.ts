import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppError,
  RUNTIME_CAPABILITY_KEYS,
  RUNTIME_UNSUPPORTED_REASON,
  unsupportedCapabilities,
} from "@tau/protocol";
import { describe, expect, it } from "vitest";
import {
  createDisabledNativeExecutor,
  createUnknownLifecyclePort,
  createUnknownWorkspaceWriterPort,
} from "./stubs";
import type { RuntimeExecutor } from "./types";
import { safeToDestroyAll } from "./types";

const REQUEST = {
  threadId: "t1",
  requestId: "r1",
  payload: { text: "hi", attachmentIds: [], origin: "user", delivery: "queue" },
} as const;

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function expectDisabled(error: unknown): void {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe("forbidden");
  expect((error as AppError).message).toContain(RUNTIME_UNSUPPORTED_REASON);
}

describe("disabled native executor", () => {
  const executor = createDisabledNativeExecutor();

  it("is the claude-code executor", () => {
    expect(executor.executor).toBe("claude-code");
  });

  it("rejects admit, inspect, cancel and reconcile as forbidden", async () => {
    expectDisabled(await rejectionOf(executor.admit(REQUEST)));
    expectDisabled(await rejectionOf(executor.inspect("t1")));
    expectDisabled(await rejectionOf(executor.cancel({ threadId: "t1", operationId: "o1" })));
    expectDisabled(await rejectionOf(executor.reconcile("t1", 0)));
  });

  it("throws on the first observe iteration", async () => {
    const iterator = executor.observe("t1", undefined)[Symbol.asyncIterator]();
    expectDisabled(await rejectionOf(iterator.next()));
  });

  it("reports every capability as unsupported with the reason", async () => {
    const capabilities = await executor.capabilities("t1");
    expect(capabilities).toEqual(unsupportedCapabilities(RUNTIME_UNSUPPORTED_REASON));
    for (const key of RUNTIME_CAPABILITY_KEYS) {
      expect(capabilities[key]).toEqual({ supported: false, reason: RUNTIME_UNSUPPORTED_REASON });
    }
  });
});

describe("unknown ports", () => {
  it("lifecycle port never reports idle", async () => {
    expect(await createUnknownLifecyclePort().inspectWriter("t1")).toBe("unknown");
  });

  it("workspace port reports one unknown writer for any key", async () => {
    const writers = await createUnknownWorkspaceWriterPort().writersOf("ws-1");
    expect(writers).toHaveLength(1);
    expect(writers[0]?.state).toBe("unknown");
    expect(safeToDestroyAll(writers)).toBe(false);
  });
});

describe("safeToDestroyAll", () => {
  it("is true for an empty list", () => {
    expect(safeToDestroyAll([])).toBe(true);
  });

  it("is false when any writer is unknown", () => {
    expect(safeToDestroyAll([{ state: "settled" }, { state: "unknown" }])).toBe(false);
  });

  it("is false when any writer is running", () => {
    expect(safeToDestroyAll([{ state: "running" }])).toBe(false);
  });

  it("is true when every writer is settled", () => {
    expect(safeToDestroyAll([{ state: "settled" }, { state: "settled" }])).toBe(true);
  });
});

describe("RuntimeExecutor type", () => {
  it("accepts a minimal fake", () => {
    const fake: RuntimeExecutor = {
      executor: "pi",
      admit: () => Promise.reject(new Error("unused")),
      inspect: () => Promise.reject(new Error("unused")),
      observe: () => ({
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      }),
      cancel: () => Promise.reject(new Error("unused")),
      reconcile: async () => "settled",
      capabilities: async () => unsupportedCapabilities("fake"),
    };
    expect(fake.executor).toBe("pi");
  });
});

describe("engine-neutral sources", () => {
  const directory = dirname(fileURLToPath(import.meta.url));

  it.each(["types.ts", "stubs.ts"])("%s names no engine package", (file) => {
    const source = readFileSync(join(directory, file), "utf8");
    expect(source).not.toContain("pi-durable");
    expect(source).not.toContain("claude-agent-sdk");
  });
});
