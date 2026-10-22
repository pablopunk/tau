import type { ConversationStatus, ConversationSummary, Core } from "@tau/protocol";
import { describe, expect, it, vi } from "vitest";
import type { SettleOutcome } from "../../harness/runtime-store";
import {
  createNativeCheckpointPort,
  createNativeFinalizer,
  type NativeCheckpointPort,
  refuseGoalsOnNative,
  refuseLoopsOnNative,
  statusOfOutcome,
} from "./finalize";

const thread = { id: "7", projectId: "p1" };

function port(overrides: Partial<NativeCheckpointPort> = {}) {
  const calls: string[] = [];
  const fake: NativeCheckpointPort = {
    applies: async () => true,
    snapshotBefore: async (_id, requestId) => {
      calls.push(`before:${requestId}`);
    },
    hasBefore: async () => true,
    snapshotAfter: async (_id, operationId) => {
      calls.push(`after:${operationId}`);
    },
    ...overrides,
  };
  return { fake, calls };
}

function finalizerWith(checkpoints?: NativeCheckpointPort) {
  const published: { status: ConversationStatus }[] = [];
  const finalizer = createNativeFinalizer({
    ...(checkpoints && { checkpoints }),
    publish: async (_thread, status) => {
      published.push({ status });
    },
  });
  return { finalizer, published };
}

describe("checkpointBefore", () => {
  it("proceeds when no checkpoint port is wired", async () => {
    expect(await finalizerWith().finalizer.checkpointBefore("7", "r1")).toEqual({ ok: true });
  });

  it("proceeds without snapshotting when checkpoints do not apply", async () => {
    const { fake, calls } = port({ applies: async () => false });

    expect(await finalizerWith(fake).finalizer.checkpointBefore("7", "r1")).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it("proceeds when the snapshot is recorded", async () => {
    const { fake, calls } = port();

    expect(await finalizerWith(fake).finalizer.checkpointBefore("7", "r1")).toEqual({ ok: true });
    expect(calls).toEqual(["before:r1"]);
  });

  it.each([
    ["the snapshot is not recorded", { hasBefore: async () => false }, "was not recorded"],
    [
      "taking it throws",
      {
        snapshotBefore: async () => {
          throw new Error("index.lock exists");
        },
      },
      "index.lock exists",
    ],
    [
      "asking whether it applies throws",
      {
        applies: async () => {
          throw new Error("git is missing");
        },
      },
      "git is missing",
    ],
  ] satisfies [string, Partial<NativeCheckpointPort>, string][])(
    "refuses the run when %s",
    async (_what, overrides, detail) => {
      const result = await finalizerWith(port(overrides).fake).finalizer.checkpointBefore("7", "r1");

      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining(detail) });
      expect(result).toMatchObject({
        reason: expect.stringContaining("Could not take the checkpoint before the run"),
      });
    },
  );
});

describe("finalize", () => {
  const outcomes: readonly [SettleOutcome, ConversationStatus, boolean][] = [
    ["completed", "idle", true],
    ["failed", "error", true],
    ["cancelled", "idle", true],
    ["interrupted", "error", true],
    ["outcome-unknown", "error", false],
  ];

  it.each(outcomes)(
    "%s publishes %s and takes the checkpoint after: %s",
    async (outcome, status, takesAfter) => {
      const { fake, calls } = port();
      const { finalizer, published } = finalizerWith(fake);

      const report = await finalizer.finalize(thread, { operationId: "op-1", outcome });

      expect(report).toEqual({
        operationId: "op-1",
        outcome,
        duplicate: false,
        status,
        steps: takesAfter ? ["checkpoint-after", "index-and-changes"] : ["index-and-changes"],
      });
      expect(calls).toEqual(takesAfter ? ["after:op-1"] : []);
      expect(published).toEqual([{ status }]);
      expect(statusOfOutcome(outcome)).toBe(status);
    },
  );

  it("does nothing the second time for the same operation, even when started together", async () => {
    const { fake, calls } = port();
    const { finalizer, published } = finalizerWith(fake);

    const [first, second] = await Promise.all([
      finalizer.finalize(thread, { operationId: "op-1", outcome: "completed" }),
      finalizer.finalize(thread, { operationId: "op-1", outcome: "completed" }),
    ]);
    const third = await finalizer.finalize(thread, { operationId: "op-1", outcome: "cancelled" });

    expect([first.duplicate, second.duplicate, third.duplicate].sort()).toEqual([false, true, true]);
    expect(calls).toEqual(["after:op-1"]);
    expect(published).toHaveLength(1);
  });

  it("finalizes each operation id on its own", async () => {
    const { fake, calls } = port();
    const { finalizer } = finalizerWith(fake);

    await finalizer.finalize(thread, { operationId: "op-1", outcome: "completed" });
    await finalizer.finalize(thread, { operationId: "op-2", outcome: "failed" });

    expect(calls).toEqual(["after:op-1", "after:op-2"]);
  });

  it("skips the checkpoint when it does not apply, and still publishes", async () => {
    const { fake, calls } = port({ applies: async () => false });
    const { finalizer, published } = finalizerWith(fake);

    const report = await finalizer.finalize(thread, { operationId: "op-1", outcome: "completed" });

    expect(calls).toEqual([]);
    expect(report.steps).toEqual(["index-and-changes"]);
    expect(published).toEqual([{ status: "idle" }]);
  });

  it("still publishes when the checkpoint after fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fake } = port({
      snapshotAfter: async () => {
        throw new Error("disk full");
      },
    });
    const { finalizer, published } = finalizerWith(fake);

    const report = await finalizer.finalize(thread, { operationId: "op-1", outcome: "completed" });

    expect(report.steps).toEqual(["index-and-changes"]);
    expect(published).toEqual([{ status: "idle" }]);
    error.mockRestore();
  });
});

describe("createNativeCheckpointPort", () => {
  const summary = (state: "ready" | "removed", path = "/work"): ConversationSummary =>
    ({ id: "7", workspace: { state, path } }) as unknown as ConversationSummary;

  const portOver = (found: ConversationSummary | undefined, repo: { root: string } | undefined) => {
    const checkpoints = {
      snapshotBefore: vi.fn(async () => undefined),
      snapshotAfter: vi.fn(async () => undefined),
    };
    const items = [
      { kind: "before", requestId: "r1" },
      { kind: "after", requestId: "r2" },
    ];
    const created = createNativeCheckpointPort({
      checkpoints,
      store: { read: async () => ({ root: "", gitDir: "", next: 1, items }) as never },
      find: async () => found,
      repoOf: async () => (repo ? { root: repo.root, commonDir: `${repo.root}/.git` } : undefined),
    });
    return { created, checkpoints };
  };

  it("applies only to a thread with a live workspace inside a git work tree", async () => {
    expect(await portOver(summary("ready"), { root: "/work" }).created.applies("7")).toBe(true);
    expect(await portOver(summary("ready"), undefined).created.applies("7")).toBe(false);
    expect(await portOver(summary("removed"), { root: "/work" }).created.applies("7")).toBe(false);
    expect(await portOver(undefined, { root: "/work" }).created.applies("7")).toBe(false);
  });

  it("sees a before only for the asked request and delegates the snapshots", async () => {
    const { created, checkpoints } = portOver(summary("ready"), { root: "/work" });

    expect(await created.hasBefore("7", "r1")).toBe(true);
    expect(await created.hasBefore("7", "r2")).toBe(false);
    expect(await created.hasBefore("7", "r3")).toBe(false);
    await created.snapshotBefore("7", "r1");
    await created.snapshotAfter("7", "op-1");
    expect(checkpoints.snapshotBefore).toHaveBeenCalledWith("7", "r1");
    expect(checkpoints.snapshotAfter).toHaveBeenCalledWith("7", "op-1");
  });
});

describe("Pi-only consumers refuse native threads", () => {
  const nativeIds = new Set(["native-1"]);
  const isNative = async (id: string) => nativeIds.has(id);

  it("refuses to set a goal on a native thread before the goal service is touched", async () => {
    const goals = {
      set: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      clear: vi.fn(async () => undefined),
    } satisfies Core["goals"];
    const guarded = refuseGoalsOnNative(goals, isNative);

    await expect(guarded.set("native-1", "ship it")).rejects.toMatchObject({ code: "invalid_request" });
    await guarded.set("pi-1", "ship it");
    await guarded.get("native-1");
    await guarded.clear("native-1");

    expect(goals.set).toHaveBeenCalledTimes(1);
    expect(goals.set).toHaveBeenCalledWith("pi-1", "ship it");
    expect(goals.get).toHaveBeenCalledTimes(1);
    expect(goals.clear).toHaveBeenCalledTimes(1);
  });

  it("refuses to start a loop on a native thread before the timers are touched", async () => {
    const loop = vi.fn(async () => undefined);
    const timers = { loop, list: vi.fn(async () => []) } as unknown as Core["timers"];
    const guarded = refuseLoopsOnNative(timers, isNative);

    await expect(guarded.loop("native-1", { prompt: "poll" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await guarded.loop("pi-1", { prompt: "poll" });

    expect(loop).toHaveBeenCalledTimes(1);
    expect(loop).toHaveBeenCalledWith("pi-1", { prompt: "poll" });
  });
});
