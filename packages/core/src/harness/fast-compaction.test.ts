import type { Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import type { CompactionHooks, EntryRecord, HookApi } from "@earendil-works/pi-durable";
import type { Settings } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { createFakeDecideClient } from "../decisions/fake";
import {
  type FastCompactionDeps,
  groupFrames,
  makeFastCompactionExtension,
} from "./fast-compaction";

const api = { models: { getAuth: async () => undefined } } as unknown as HookApi;
const context = { abortSignal: undefined } as unknown as Context;

function userEntry(id: string, text: string): EntryRecord {
  return {
    id: id as unknown as EntryRecord["id"],
    conversationId: "c1" as unknown as EntryRecord["conversationId"],
    kind: "user",
    model: [{ role: "user", content: [{ type: "text", text }] } as Message],
  };
}

function callEntry(id: string, name: string, args: unknown): EntryRecord {
  return {
    id: id as unknown as EntryRecord["id"],
    conversationId: "c1" as unknown as EntryRecord["conversationId"],
    kind: "assistant",
    model: [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: `call-${id}`, name, arguments: args }],
      } as unknown as Message,
    ],
  };
}

function resultEntry(id: string, toolName: string, text: string): EntryRecord {
  return {
    id: id as unknown as EntryRecord["id"],
    conversationId: "c1" as unknown as EntryRecord["conversationId"],
    kind: "tool-result",
    model: [
      {
        role: "toolResult",
        toolCallId: `call-${id}`,
        toolName,
        content: [{ type: "text", text }],
        isError: false,
        timestamp: 0,
      } as unknown as Message,
    ],
  };
}

function settings(backend: "auto" | "typesafe" | "openai" = "auto", mode = "fast"): Settings {
  return { compaction: { mode, backend } } as unknown as Settings;
}

function depsFor(
  backendClients: FastCompactionDeps["decideClients"],
  options?: { backend?: "auto" | "typesafe" | "openai"; mode?: string; thresholds?: FastCompactionDeps["thresholds"] },
): FastCompactionDeps {
  const mode = options?.mode ?? "fast";
  const backend = options?.backend ?? "auto";
  return {
    settingsStore: { get: async () => settings(backend, mode) },
    credentials: { read: async () => undefined },
    env: {},
    decideClients: backendClients,
    ...(options?.thresholds && { thresholds: options.thresholds }),
  };
}

function hookOf(deps: FastCompactionDeps): CompactionHooks["beforeCompact"] {
  const extension = makeFastCompactionExtension(deps);
  const handlers = extension.hooks?.[0]?.handlers as {
    beforeCompact: CompactionHooks["beforeCompact"];
  };
  return handlers.beforeCompact;
}

/** e1 user, e2+e3 first tool exchange, e4+e5 second tool exchange. */
function entries(): EntryRecord[] {
  return [
    userEntry("e1", "initial question"),
    callEntry("e2", "read", { path: "kept.ts" }),
    resultEntry("e3", "read", `contents of kept.ts\n${"x".repeat(2000)}`),
    callEntry("e4", "exec", { command: "rm -rf /tmp/scratch" }),
    resultEntry("e5", "exec", `transient output\n${"y".repeat(2000)}`),
  ];
}

describe("groupFrames", () => {
  it("keeps each call with its results atomically", () => {
    const frames = groupFrames(entries());
    expect(frames.map((frame) => frame.entryIds)).toEqual([["e1"], ["e2", "e3"], ["e4", "e5"]]);
  });
});

describe("beforeCompact", () => {
  it("defers to built-in when instructions are present", async () => {
    const fake = createFakeDecideClient({ id: "typesafe", probabilities: [0.1, 0.1] });
    const beforeCompact = hookOf(depsFor([fake]));
    const outcome = await beforeCompact(
      { reason: "manual", entries: entries(), messages: [], firstKept: "e9" as unknown as EntryRecord["id"], instructions: "focus" },
      api,
      context,
    );
    expect(outcome).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("defers to built-in when fast mode is off", async () => {
    const fake = createFakeDecideClient({ id: "typesafe", probabilities: [0.1, 0.1] });
    const beforeCompact = hookOf(depsFor([fake], { mode: "summary" }));
    expect(
      await beforeCompact(
        { reason: "threshold", entries: entries(), messages: [], firstKept: "e9" as unknown as EntryRecord["id"] },
        api,
        context,
      ),
    ).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("drops low-scoring frames, pins first and recent, and renders a verbatim summary", async () => {
    // Scored frames in order: [e2+e3] then [e4+e5] is pinned (newest message) — wait, pin e5 only.
    // preserveRecentMessages: 1 pins the e5 frame; e1 pinned as first; e2+e3 scored.
    const fake = createFakeDecideClient({ id: "typesafe", probabilities: [0.05, 0.05] });
    const beforeCompact = hookOf(depsFor([fake], { thresholds: { preserveRecentMessages: 1 } }));
    const outcome = await beforeCompact(
      { reason: "threshold", entries: entries(), messages: [], firstKept: "e9" as unknown as EntryRecord["id"] },
      api,
      context,
    );
    expect(fake.calls).toHaveLength(2);
    expect(outcome).toMatchObject({ summary: expect.stringContaining("backend=typesafe") });
    const summary = (outcome as { summary: string }).summary;
    // Pinned content survives verbatim; the dropped exchange does not.
    expect(summary).toContain("initial question");
    expect(summary).toContain("rm -rf /tmp/scratch");
    expect(summary).not.toContain("kept.ts");
    expect(summary).toContain("decisions:");
  });

  it("truncates mixed-score frames to a head plus a note", async () => {
    const fake = createFakeDecideClient({ id: "typesafe", probabilities: [0.9, 0.1, 0.1, 0.1] });
    const beforeCompact = hookOf(
      depsFor([fake], { thresholds: { preserveRecentMessages: 1, truncateHeadChars: 10 } }),
    );
    const outcome = await beforeCompact(
      { reason: "threshold", entries: entries(), messages: [], firstKept: "e9" as unknown as EntryRecord["id"] },
      api,
      context,
    );
    const summary = (outcome as { summary: string }).summary;
    expect(summary).toContain("result truncated to 10 chars");
    expect(summary).toContain("more chars omitted");
  });

  it("falls back to built-in below the minimum reduction ratio", async () => {
    // Everything kept: no reduction, so the hook defers even on overflow — never declines.
    const fake = createFakeDecideClient({ id: "typesafe", probabilities: [0.99, 0.99] });
    const beforeCompact = hookOf(depsFor([fake], { thresholds: { preserveRecentMessages: 1 } }));
    for (const reason of ["manual", "threshold", "overflow"] as const) {
      const outcome = await beforeCompact(
        { reason, entries: entries(), messages: [], firstKept: "e9" as unknown as EntryRecord["id"] },
        api,
        context,
      );
      expect(outcome).toBeUndefined();
    }
  });

  it("falls back to built-in on client error or timeout, never declining overflow", async () => {
    const failing = {
      id: "typesafe",
      check: async () => "ready" as const,
      predicate: async () => {
        throw new Error("boom");
      },
    } as const;
    const beforeCompact = hookOf(depsFor([failing], { thresholds: { preserveRecentMessages: 1 } }));
    const outcome = await beforeCompact(
      { reason: "overflow", entries: entries(), messages: [], firstKept: "e9" as unknown as EntryRecord["id"] },
      api,
      context,
    );
    expect(outcome).toBeUndefined();

    const hanging = {
      id: "typesafe",
      check: async () => "ready" as const,
      predicate: () => new Promise<number>(() => undefined),
    } as const;
    const slow = hookOf(depsFor([hanging], { thresholds: { preserveRecentMessages: 1, predicateTimeoutMs: 5 } }));
    const timedOut = await slow(
      { reason: "overflow", entries: entries(), messages: [], firstKept: "e9" as unknown as EntryRecord["id"] },
      api,
      context,
    );
    expect(timedOut).toBeUndefined();
  });

  it("pins an explicit backend and tries the other only as fallback", async () => {
    const typesafe = createFakeDecideClient({ id: "typesafe", probabilities: [0.05, 0.05] });
    const openai = createFakeDecideClient({ id: "openai", probabilities: [0.05, 0.05] });
    const beforeCompact = hookOf(depsFor([typesafe, openai], { backend: "openai", thresholds: { preserveRecentMessages: 1 } }));
    const outcome = await beforeCompact(
      { reason: "threshold", entries: entries(), messages: [], firstKept: "e9" as unknown as EntryRecord["id"] },
      api,
      context,
    );
    expect(typesafe.calls).toHaveLength(0);
    expect(openai.calls).toHaveLength(2);
    expect(outcome).toMatchObject({ summary: expect.stringContaining("backend=openai") });
  });
});
