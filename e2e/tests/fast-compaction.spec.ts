import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  type FauxWorld,
  isRunning,
  openFauxWorld,
  setUpConversation,
  trackView,
  waitForAnswer,
  waitUntil,
} from "../../packages/core/src/test-support/faux-core";
import type { ConversationView, EntryRecord } from "../../packages/protocol/src/view";
import { type DecisionMock, repeat, startDecisionMock } from "./fast-compaction-mocks";

/**
 * Fast-compaction e2e (PLAN-jev-compaction §5 + test plan). Localhost mocks
 * only; no real API. Drives compaction through `conversations` RPC on a real
 * core (faux provider) in a temp dir.
 *
 * Env seams (MUST-AGREE with the hook, now landed): TAU_TYPESAFE_BASE_URL
 * overrides the TypeSafe API base, TAU_OPENAI_DECISIONS_URL the full decisions
 * endpoint. Response shapes are a superset so the hook's parsers find the
 * score (`answers.keep.noul` for TypeSafe, top-level `probability` for OpenAI).
 *
 * Windowing dynamics that shape these scenarios: pi-durable compacts
 * incrementally (keepRecentTokens=20k), so each beforeCompact window holds
 * only a few entries; the hook pins first + newest-6 messages and scores the
 * rest. Histories must therefore accumulate quietly past ~14 small turns
 * before the first background compaction sees an unpinned middle — big seeds
 * trip per-send steady-state compactions whose windows never escape pinning.
 */

// Env seams read by the live DecideClients (see NOTE-FOR-INTEGRATOR.md):
// TAU_TYPESAFE_BASE_URL overrides the TypeSafe API base (client appends
// /v1/systemone and /v1/models); TAU_OPENAI_DECISIONS_URL overrides the full
// decisions endpoint. Single constants to rename in one place.
const TYPESAFE_ENV = "TAU_TYPESAFE_BASE_URL";
const OPENAI_ENV = "TAU_OPENAI_DECISIONS_URL";

const bigText = (tag: string) => `${tag} ${"lorem ipsum ".repeat(3500)}`;
/** ~1.4KB turns: matches the probed accumulation profile — ~14 quiet turns
 * then a first background compaction with a scorable ~20-entry window. */
const midText = (tag: string) => `${tag} ${"lorem ipsum ".repeat(400)}`;

const summaries = (view: ConversationView | null): EntryRecord[] =>
  view?.entries.filter((entry: EntryRecord) => entry.kind === "pi.compaction") ?? [];

/** Verbatim text of a placed summary, wherever pi stored it. */
function summaryTextOf(entry: EntryRecord): string {
  const parts: string[] = [];
  for (const message of (entry.model ?? []) as readonly {
    role?: string;
    content?: unknown;
  }[]) {
    if (typeof message.content === "string") parts.push(message.content);
    else if (Array.isArray(message.content))
      for (const block of message.content as readonly { type?: unknown; text?: unknown }[])
        if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

const fastSummaries = (view: ConversationView | null): EntryRecord[] =>
  summaries(view).filter((entry) => summaryTextOf(entry).includes("<fast-compaction"));

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
    [TYPESAFE_ENV]: mocks.typesafe.url,
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

/**
 * Small seed for the scoring tests: ~1.4KB turns accumulate quietly (no
 * threshold compaction) until the first background compaction sees a ~20-entry
 * window with unpinned middle frames to score. Big seeds trip per-send
 * steady-state compactions whose windows never escape pinning, so the mocks
 * stay silent. Callers send turns one at a time and stop at first signal.
 */
async function worldWithSmallSeed(
  mocks: { typesafe: DecisionMock; openai: DecisionMock },
  backend: "auto" | "typesafe" | "openai",
) {
  const root = await mkdtemp(join(tmpdir(), "tau-fast-compact-"));
  const world = await openWorld(root, mocks);
  await enableFast(world, backend);
  const { conversation } = await setUpConversation(world, midText("seed"));
  return { root, world, conversationId: conversation.id };
}

async function viewOf(world: FauxWorld, conversationId: string): Promise<ConversationView | null> {
  const tracker = await trackView(world.core, conversationId);
  const view = tracker.view();
  await tracker.stop();
  return view;
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
      const first = (await (
        await fetch(`${typesafe.url}/v1/systemone`, {
          method: "POST",
          body: JSON.stringify({ questions: { keep: { type: "noul", input: "a", instructions: "keep?" } } }),
        })
      ).json()) as { probability: number };
      expect(first.probability).toBe(0.1);
      const second = (await (
        await fetch(`${typesafe.url}/v1/systemone`, { method: "POST", body: "{}" })
      ).json()) as { probability: number };
      expect(second.probability).toBe(0.9);
      // Exhausted scripts repeat the last value.
      const third = (await (
        await fetch(`${typesafe.url}/v1/systemone`, { method: "POST", body: "{}" })
      ).json()) as { probability: number };
      expect(third.probability).toBe(0.9);
      const only = (await (
        await fetch(`${openai.url}/v1/decisions`, {
          method: "POST",
          body: JSON.stringify({ predicate: "keep?", input: "b" }),
        })
      ).json()) as { probability: number };
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
    const { root, world, conversationId } = await worldWithSmallSeed({ typesafe, openai }, "typesafe");
    // Grow history one turn at a time; the first background compaction with an
    // unpinned middle scores and (all-drop clears the reduction floor) goes fast.
    // Stop at the marker: every later compaction would only fold it away.
    const sentTags: string[] = [];
    let fast: EntryRecord[] = [];
    try {
      for (let i = 1; i <= 25; i++) {
        const tag = `turn${i}`;
        await sendAndSettle(world, conversationId, midText(tag), tag);
        sentTags.push(tag);
        fast = fastSummaries(await viewOf(world, conversationId));
        if (fast.length > 0) break;
      }
      const view = await viewOf(world, conversationId);
      const placed = summaries(view);
      fast = fastSummaries(view);
      // The hook really scored: mock calls happened and a fast summary was placed.
      expect(typesafe.hits.length).toBeGreaterThan(0);
      expect(placed.length).toBeGreaterThanOrEqual(1);
      expect(fast.length).toBeGreaterThanOrEqual(1);
      const last = summaryTextOf(fast[fast.length - 1] as EntryRecord);
      expect(last).toContain("<fast-compaction backend=typesafe>");
      expect(last).toContain("verdict=drop");
      // A pruned early turn is omitted while the pinned first message
      // survives verbatim. (Faux assistant replies echo user text, so each
      // tag appears twice per turn; turn2 sits deep in the scored middle.
      // The newest sent turns live in the uncompacted tail, not the summary.)
      expect(last).not.toContain(`${sentTags[1] as string} lorem`);
      expect(last).toContain("seed lorem");
    } finally {
      await closeWorld(root, world, [typesafe, openai]);
    }
  });

  test("keep-all scoring still places a summary", async () => {
    const typesafe = await startDecisionMock({ backend: "typesafe", probabilities: repeat(0.95, 64) });
    const openai = await startDecisionMock({ backend: "openai", probabilities: repeat(0.95, 64) });
    const { root, world, conversationId } = await worldWithSmallSeed({ typesafe, openai }, "openai");
    try {
      for (let i = 1; i <= 25; i++) {
        const tag = `turn${i}`;
        await sendAndSettle(world, conversationId, midText(tag), tag);
        if (openai.hits.length > 0) break;
      }
      // The hook really scored against the mock...
      expect(openai.hits.length).toBeGreaterThan(0);
      // ...then deferred to built-in: all-keep output can never clear the
      // minReductionRatio floor, so no fast summary is ever placed and no
      // verbatim-keep assertion is possible here by design.
      let placed: EntryRecord[] = [];
      for (let attempt = 0; attempt < 30; attempt++) {
        placed = summaries(await viewOf(world, conversationId));
        if (placed.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      expect(placed.length).toBeGreaterThanOrEqual(1);
      expect(fastSummaries(await viewOf(world, conversationId))).toHaveLength(0);
    } finally {
      await closeWorld(root, world, [typesafe, openai]);
    }
  });

  test("continuity: two compactions, the second re-scores", async () => {
    const typesafe = await startDecisionMock({ backend: "typesafe", probabilities: repeat(0.4, 128) });
    const openai = await startDecisionMock({ backend: "openai", probabilities: repeat(0.4, 128) });
    const { root, world, conversationId } = await worldWithSmallSeed({ typesafe, openai }, "auto");
    const hitsOf = () => typesafe.hits.length + openai.hits.length;
    try {
      for (let i = 1; i <= 25; i++) {
        const tag = `turn${i}`;
        await sendAndSettle(world, conversationId, midText(tag), tag);
        if (fastSummaries(await viewOf(world, conversationId)).length > 0) break;
      }
      const hitsAfterFirst = hitsOf();
      expect(hitsAfterFirst).toBeGreaterThan(0);
      // Regrow past the pruned tail; the next background compaction re-scores.
      // Stop at first growth: later steady-state compactions only fold summaries.
      for (let i = 101; i <= 106; i++) {
        await sendAndSettle(world, conversationId, midText(`turn${i}`), `turn${i}`);
        if (hitsOf() > hitsAfterFirst) break;
      }
      // The second compaction re-scored the grown history: strictly more mock calls.
      await waitUntil(() => hitsOf() > hitsAfterFirst, "the second compaction to re-score");
      const placed = summaries(await viewOf(world, conversationId));
      expect(placed.length).toBeGreaterThanOrEqual(1);
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
