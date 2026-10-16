import type { Models } from "@earendil-works/pi-ai/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import { updateLiveConversation } from "../harness/conversation-index";
import {
  type ConversationHarness,
  FAUX_MODEL,
  openConversationHarness,
  startRequest,
} from "../test-support/conversation-harness";
import { useTempDir } from "../test-support/temp-dir";
import { createTitleService } from "./title-service";

const tempDir = useTempDir();
let world: ConversationHarness;
let conversationId: number;

const answer = (text: string, stopReason = "stop") => ({
  stopReason,
  content: [{ type: "text", text }],
  errorMessage: stopReason === "error" ? "boom" : undefined,
});

function serviceWith(
  completeSimple: (...args: never[]) => unknown,
  options: { timeoutMs?: number; fastModel?: typeof FAUX_MODEL | null } = {},
) {
  const changes = createChangeEmitter();
  const seen: unknown[] = [];
  changes.subscribe((change) => seen.push(change));
  const models = { getModel: () => ({ id: "m" }), completeSimple } as unknown as Models;
  const settings = { get: async () => ({ fastModel: options.fastModel ?? null }) } as never;
  const service = createTitleService({
    harness: world.harness,
    models,
    settings,
    changes,
    timeoutMs: options.timeoutMs,
  });
  return { service, seen };
}

const titleOf = async () => (await world.store.list(world.project.id))[0]?.title;

beforeEach(async () => {
  world = await openConversationHarness(await tempDir());
  const { summary } = await world.store.start(startRequest(world, "Refactor the login flow today", "t"));
  conversationId = Number(summary.id);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await world.close();
});

describe("title job", () => {
  it("replaces the provisional title with a cleaned model answer and announces it", async () => {
    const { service, seen } = serviceWith(async () => answer('Title: "Fix login flow"\nSecond line'));
    await service.generateFor(String(conversationId), "Refactor the login flow today");
    expect(await titleOf()).toBe("Fix login flow");
    expect(seen).toContainEqual({ resource: "conversations", projectId: world.project.id });
  });

  it("asks the fast model first", async () => {
    const getModel = vi.fn(() => ({ id: "fast" }));
    const complete = vi.fn(async () => answer("Named"));
    const settings = { get: async () => ({ fastModel: FAUX_MODEL }) } as never;
    const service = createTitleService({
      harness: world.harness,
      models: { getModel, completeSimple: complete } as unknown as Models,
      settings,
      changes: createChangeEmitter(),
    });
    await service.generateFor(String(conversationId), "x");
    expect(getModel).toHaveBeenCalledWith(FAUX_MODEL.provider, FAUX_MODEL.modelId);
  });

  it("keeps the provisional title when the model fails, aborts or says nothing", async () => {
    for (const reply of [answer("", "error"), answer("x", "aborted"), answer("   ")]) {
      await serviceWith(async () => reply).service.generateFor(String(conversationId), "x");
    }
    await serviceWith(async () => {
      throw new Error("network");
    }).service.generateFor(String(conversationId), "x");
    expect(await titleOf()).toBe("Refactor the login flow today");
  });

  it("gives up when the request outlives its timeout", async () => {
    const hangs = (_model: unknown, _context: unknown, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(options.signal.reason)),
      );
    const { service } = serviceWith(hangs, { timeoutMs: 20 });
    await service.generateFor(String(conversationId), "x");
    expect(await titleOf()).toBe("Refactor the login flow today");
  });

  it("does not replace a title the user chose or a deleted thread's", async () => {
    await world.store.rename(String(conversationId), "Mine");
    await serviceWith(async () => answer("Generated")).service.generateFor(String(conversationId), "x");
    expect(await titleOf()).toBe("Mine");
  });

  it("never writes after the thread is deleted", async () => {
    await world.store.remove(String(conversationId), 5);
    const { service, seen } = serviceWith(async () => answer("Generated"));
    await service.generateFor(String(conversationId), "x");
    const applied = await updateLiveConversation(
      world.harness,
      conversationId as never,
      world.project.id,
      () => true,
    );
    expect(applied).toBe(false);
    expect(seen).toEqual([]);
  });
});
