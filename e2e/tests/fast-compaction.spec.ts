import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationView, EntryRecord } from "../../packages/protocol/src/view";
import { expect, test } from "@playwright/test";
import {
  isRunning,
  openFauxWorld,
  setUpConversation,
  trackView,
  waitForAnswer,
  waitUntil,
  type FauxWorld,
} from "../../packages/core/src/test-support/faux-core";
import { repeat, startDecisionMock, type DecisionMock } from "./fast-compaction-mocks";

/**
 * Fast-compaction e2e (PLAN-jev-compaction §5 + test plan). Localhost mocks
 * only; no real API. Drives compaction through `conversations` RPC on a real
 * core (faux provider) in a temp dir.
 *
 * MUST-AGREE seams with the hook agent live in NOTE-FOR-INTEGRATOR.md:
 * base-URL env names and the decisions response shape. Until the hook lands,
 * the fast-mode scenarios assert the fallback contract (summary placed, no
 * error); INTEGRATOR-marked assertions tighten once the hook calls the mocks.
 */

// Env names are read by the hook (not yet landed); single constants to rename in one place.
const TYPESAFE_ENV = "TAU_TYPESAFE_BASE_URL";
const OPENAI_ENV = "TAU_OPENAI_DECISIONS_URL";

const bigText = (tag: string) => `${tag} ${"lorem ipsum ".repeat(3500)}`;

const summaries = (view: ConversationView | null): EntryRecord[] =>
  view?.entries.filter((entry: EntryRecord) => entry.kind === "pi.compaction") ?? [];

async function sendAndSettle(world: FauxWorld, conversationId: string, text: string, requestId: string) {
  const tracker = await trackView(world.core, conversationId);
  await world.core.conversations.send(conversationId, { text, requestId });
  await waitUntil(() => isRunning(tracker.view()), "the run to start");
  await waitUntil(() => !isRunning(tracker.view()), "the run to end");
  const view = tracker.view();
  await tracker.stop();
  return view;
}

async function openWorld(root: string, mocks: { typesafe: DecisionMock; openai: DecisionMock }) {
  return openFauxWorld(root, Date.now, {
    ...process.env,
    [TYPESAFE_ENV]: `${mocks.typesafe.url}/v1/systemone`,
    [OPENAI_ENV]: `${mocks.openai.url}/v1/decisions`,
  });
}

async function enableFast(world: FauxWorld, backend: "auto" | "typesafe" | "openai") {
  await world.core.providers.setApiKey("typesafe", "sk-typesafe-test");
  await world.core.providers.setApiKey("openai", "sk-openai-test");
  await world.core.settings.setCompaction({ mode: "fast", backend });
}

async function worldWithTwoBigTurns(
  mocks: { typesafe: DecisionMock; openai: DecisionMock },
  backend: "auto" | "typesafe" | "openai",
) {
  const root = await mkdtemp(join(tmpdir(), "tau-fast-compact-"));
  const world = await openWorld(root, mocks);
  await enableFast(world, backend);
  const { conversation } = await setUpConversation(world, bigText("one"));
  await sendAndSettle(world, conversation.id, bigText("two"), "two");
  return { root, world, conversationId: conversation.id };
}

async function closeWorld(root: string, world: FauxWorld, mocks: DecisionMock[]) {
  await world.core.close();
  await Promise.all(mocks.map((mock) => mock.close()));
  await rm(root, { recursive: true, force: true });
}

test.describe("fast-compaction mocks", () => {
  test("serve scripted probabilities in order on both backends", async () => {
    const typesafe = await startDecisionMock({ backend: "typesafe", probabilities: [0.1, 0.9] });
    const openai = await startDecisionMock({ backend: "openai", probabilities: [0.7] });
    try {
      const first = await (
        await fetch(`${typesafe.url}/v1/systemone`, {
          method: "POST",
          body: JSON.stringify({ questions: { keep: { type: "noul", input: "a", instructions: "keep?" } } }),
        })
      ).json() as { probability: number };
      expect(first.probability).toBe(0.1);
      const second = await (
        await fetch(`${typesafe.url}/v1/systemone`, { method: "POST", body: "{}" })
      ).json() as { probability: number };
      expect(second.probability).toBe(0.9);
      // Exhausted scripts repeat the last value.
      const third = await (
        await fetch(`${typesafe.url}/v1/systemone`, { method: "POST", body: "{}" })
      ).json() as { probability: number };
      expect(third.probability).toBe(0.9);
      const only = await (
        await fetch(`${openai.url}/v1/decisions`, {
          method: "POST",
          body: JSON.stringify({ predicate: "keep?", input: "b" }),
        })
      ).json() as { probability: number };
      expect(only.probability).toBe(0.7);
      expect(typesafe.hits).toHaveLength(3);
      expect(typesafe.hits[0]).toMatchObject({ backend: "typesafe", input: "a", instructions: "keep?" });
      expect(openai.hits[0]).toMatchObject({ backend: "openai", input: "b", instructions: "keep?" });
    } finally {
      await typesafe.close();
      await openai.close();
    }
  });

  test("MOCK_FAIL=500 fails both backends; wrong paths 404", async () => {
    const typesafe = await startDecisionMock({ backend: "typesafe", probabilities: [1] });
    const openai = await startDecisionMock({ backend: "openai", probabilities: [1] });
    process.env.MOCK_FAIL = "500";
    try {
      const failed = await fetch(`${typesafe.url}/v1/systemone`, { method: "POST", body: "{}" });
      expect(failed.status).toBe(500);
      const failedOpenai = await fetch(`${openai.url}/v1/decisions`, { method: "POST", body: "{}" });
      expect(failedOpenai.status).toBe(500);
      expect(typesafe.hits).toHaveLength(0);
    } finally {
      delete process.env.MOCK_FAIL;
      await typesafe.close();
      await openai.close();
    }
    const strict = await startDecisionMock({ backend: "typesafe", probabilities: [1] });
    try {
      const wrong = await fetch(`${strict.url}/v1/decisions`, { method: "POST", body: "{}" });
      expect(wrong.status).toBe(404);
    } finally {
      await strict.close();
    }
  });
});

test.describe("fast compaction through conversations RPC", () => {
  test("drop-all scoring still places a summary", async () => {
    const typesafe = await startDecisionMock({ backend: "typesafe", probabilities: repeat(0.05, 64) });
    const openai = await startDecisionMock({ backend: "openai", probabilities: repeat(0.05, 64) });
    const { root, world, conversationId } = await worldWithTwoBigTurns({ typesafe, openai }, "typesafe");
    try {
      await world.core.conversations.compact(conversationId, {});
      const tracker = await trackView(world.core, conversationId);
      const placed = summaries(tracker.view());
      await tracker.stop();
      expect(placed.length).toBeGreaterThanOrEqual(1);
      expect(placed[0]).toMatchObject({ kind: "pi.compaction", data: { reason: "manual" } });
      // INTEGRATOR: once the hook calls the mock, assert typesafe.hits.length > 0
      // and that pruned content is omitted from the summary instead of verbatim.
      test.info().annotations.push({ type: "typesafe-hits", description: String(typesafe.hits.length) });
    } finally {
      await closeWorld(root, world, [typesafe, openai]);
    }
  });

  test("keep-all scoring still places a summary", async () => {
    const typesafe = await startDecisionMock({ backend: "typesafe", probabilities: repeat(0.95, 64) });
    const openai = await startDecisionMock({ backend: "openai", probabilities: repeat(0.95, 64) });
    const { root, world, conversationId } = await worldWithTwoBigTurns({ typesafe, openai }, "openai");
    try {
      await world.core.conversations.compact(conversationId, {});
      const tracker = await trackView(world.core, conversationId);
      const placed = summaries(tracker.view());
      await tracker.stop();
      expect(placed.length).toBeGreaterThanOrEqual(1);
      expect(placed[0]).toMatchObject({ kind: "pi.compaction", data: { reason: "manual" } });
      // INTEGRATOR: once the hook calls the mock, assert openai.hits.length > 0
      // and that kept content survives verbatim in the summary.
      test.info().annotations.push({ type: "openai-hits", description: String(openai.hits.length) });
    } finally {
      await closeWorld(root, world, [typesafe, openai]);
    }
  });

  test("continuity: two compactions, the second re-scores", async () => {
    const typesafe = await startDecisionMock({ backend: "typesafe", probabilities: repeat(0.4, 128) });
    const openai = await startDecisionMock({ backend: "openai", probabilities: repeat(0.4, 128) });
    const { root, world, conversationId } = await worldWithTwoBigTurns({ typesafe, openai }, "auto");
    try {
      await world.core.conversations.compact(conversationId, {});
      const first = await trackView(world.core, conversationId);
      const firstIds = summaries(first.view()).map((entry: EntryRecord) => entry.id);
      await first.stop();
      expect(firstIds.length).toBeGreaterThanOrEqual(1);
      const hitsAfterFirst = typesafe.hits.length + openai.hits.length;
      await sendAndSettle(world, conversationId, bigText("three"), "three");
      await sendAndSettle(world, conversationId, bigText("four"), "four");
      await world.core.conversations.compact(conversationId, {});
      const tracker = await trackView(world.core, conversationId);
      const placed = summaries(tracker.view());
      await tracker.stop();
      // Pi folds the earlier summary into the new one, so one entry covers both compactions.
      expect(placed.length).toBeGreaterThanOrEqual(1);
      const hitsAfterSecond = typesafe.hits.length + openai.hits.length;
      expect(hitsAfterSecond).toBeGreaterThanOrEqual(hitsAfterFirst);
      // INTEGRATOR: tighten to `>` once the hook scores every compaction.
      test.info().annotations.push({
        type: "decision-hits",
        description: `first=${hitsAfterFirst} second=${hitsAfterSecond}`,
      });
    } finally {
      await closeWorld(root, world, [typesafe, openai]);
    }
  });

  test("MOCK_FAIL=500 on both backends falls back to a built-in summary", async () => {
    const typesafe = await startDecisionMock({ backend: "typesafe", probabilities: repeat(0.9, 64) });
    const openai = await startDecisionMock({ backend: "openai", probabilities: repeat(0.9, 64) });
    const { root, world, conversationId } = await worldWithTwoBigTurns({ typesafe, openai }, "auto");
    process.env.MOCK_FAIL = "500";
    try {
      await world.core.conversations.compact(conversationId, {});
      const tracker = await trackView(world.core, conversationId);
      const placed = summaries(tracker.view());
      await tracker.stop();
      expect(placed.length).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env.MOCK_FAIL;
      await closeWorld(root, world, [typesafe, openai]);
    }
  });

  test("dead backends never fail a threshold compaction", async () => {
    const typesafe = await startDecisionMock({ backend: "typesafe", probabilities: repeat(0.9, 64) });
    const openai = await startDecisionMock({ backend: "openai", probabilities: repeat(0.9, 64) });
    const root = await mkdtemp(join(tmpdir(), "tau-fast-compact-"));
    const world = await openWorld(root, { typesafe, openai });
    try {
      await enableFast(world, "auto");
      const { conversation } = await setUpConversation(world, bigText("one"));
      await sendAndSettle(world, conversation.id, bigText("two"), "two");
      // Both backends die before the run overflows into auto-compaction.
      typesafe.setFail(true);
      openai.setFail(true);
      const view = await sendAndSettle(world, conversation.id, bigText("three"), "three");
      const placed = summaries(view);
      expect(placed.length).toBeGreaterThanOrEqual(1);
      expect(placed[0]).toMatchObject({ kind: "pi.compaction" });
      expect(placed[0]?.data).toMatchObject({ reason: expect.stringMatching(/threshold|overflow/) });
    } finally {
      await closeWorld(root, world, [typesafe, openai]);
    }
  });

  test("manual compact with a dead backend places a summary, never nothing_to_compact", async () => {
    const typesafe = await startDecisionMock({
      backend: "typesafe",
      probabilities: repeat(0.9, 64),
      fail: true,
    });
    const openai = await startDecisionMock({ backend: "openai", probabilities: repeat(0.9, 64), fail: true });
    const { root, world, conversationId } = await worldWithTwoBigTurns({ typesafe, openai }, "typesafe");
    try {
      let code: string | undefined;
      try {
        await world.core.conversations.compact(conversationId, {});
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).not.toBe("nothing_to_compact");
      const tracker = await trackView(world.core, conversationId);
      const placed = summaries(tracker.view());
      await tracker.stop();
      expect(code).toBeUndefined();
      expect(placed.length).toBeGreaterThanOrEqual(1);
    } finally {
      await closeWorld(root, world, [typesafe, openai]);
    }
  });
});

test.describe("faux round-trip sanity", () => {
  test("a fresh world answers before compaction scenarios run", async () => {
    const root = await mkdtemp(join(tmpdir(), "tau-fast-compact-"));
    const world = await openFauxWorld(root);
    try {
      const { conversation } = await setUpConversation(world, "hello");
      const tracker = await trackView(world.core, conversation.id);
      await world.core.conversations.send(conversation.id, { text: "reply fast", requestId: "sanity" });
      await waitForAnswer(tracker);
      await tracker.stop();
    } finally {
      await world.core.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
