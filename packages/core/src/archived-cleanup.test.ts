import type { ConversationSummary } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_RETENTION_MS, CLEANUP_INTERVAL_MS, createArchivedCleanup } from "./archived-cleanup";
import { createConversationRemoval } from "./conversation-removal";
import type { ConversationStore } from "./harness/conversation-store";
import type { RemovalHooks } from "./removal-hooks";

const HOUR = 60 * 60 * 1000;
const NOW = 1_000 * HOUR;

const thread = (id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  projectId: "p1",
  title: id,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: NOW - 49 * HOUR,
  status: "idle",
  lastRunEndedAt: null,
  avatarIndex: 1,
  lastActivityAt: 0,
  model: null,
  workspace: {
    mode: "worktree",
    path: `/w/${id}`,
    branch: `pi/${id}`,
    base: "main",
    state: "ready",
    mergedSha: null,
    pullRequestUrl: null,
  },
  forkOf: null,
  parentId: null,
  agentType: null,
  agentModel: null,
  agentStatus: null,
  background: false,
  agentThinking: null,
  timers: 0,
  nextTimerAt: null,
  goal: null,
  unmergedWarning: null,
  ...overrides,
});

function setUp(
  threads: ConversationSummary[],
  unmerged: Record<string, string[]> = {},
  unmergedWork?: RemovalHooks["unmergedWork"],
) {
  const alive = new Map(threads.map((item) => [item.id, item]));
  const warnings = new Map<string, string | null>();
  const discarded: string[] = [];
  const store = {
    find: async (id: string) => alive.get(id),
    list: async () => [...alive.values()],
    remove: async (id: string) => (alive.delete(id) ? "p1" : undefined),
    setUnmergedWarning: async (id: string, warning: string | null) => {
      const changed = (warnings.get(id) ?? null) !== warning;
      warnings.set(id, warning);
      return changed;
    },
  } as unknown as ConversationStore;
  const hooks: RemovalHooks = {
    unmergedWork: unmergedWork ?? (async (item) => unmerged[item.id] ?? []),
    onConversationRemoved: [async (item) => void discarded.push(item.id)],
    onProjectRemoved: [],
  };
  const removal = createConversationRemoval({
    conversations: store,
    hooks,
    now: () => NOW,
    announce: () => {},
  });
  const cleanup = createArchivedCleanup({
    conversations: store,
    removal,
    hooks,
    listArchived: async () => [...alive.values()].filter((item) => item.archivedAt !== null),
    now: () => NOW,
    announce: () => {},
    onError: () => {},
  });
  return { cleanup, alive, warnings, discarded };
}

const sweepOnce = async (cleanup: ReturnType<typeof createArchivedCleanup>) => {
  cleanup.start();
  await cleanup.stop();
};

describe("archived cleanup pass", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a thread archived 47 hours ago and deletes one archived 49 hours ago", async () => {
    const { cleanup, alive } = setUp([thread("young", { archivedAt: NOW - 47 * HOUR }), thread("old")]);
    await sweepOnce(cleanup);
    expect([...alive.keys()]).toEqual(["young"]);
    expect(ARCHIVE_RETENTION_MS).toBe(48 * HOUR);
  });

  it("keeps threads with unmerged work and stores the warning", async () => {
    const { cleanup, alive, warnings } = setUp([thread("dirty")], { dirty: ["a.txt"] });
    await sweepOnce(cleanup);
    expect(alive.has("dirty")).toBe(true);
    expect(warnings.get("dirty")).toBe("Uncommitted changes in pi/dirty");
  });

  it.each([
    [["1 unmerged commit(s)"], "Unmerged commits in pi/dirty"],
    [["a.txt", "2 unmerged commit(s)"], "Uncommitted changes and unmerged commits in pi/dirty"],
  ])("words the warning for %j", async (lines, expected) => {
    const { cleanup, warnings } = setUp([thread("dirty")], { dirty: lines });
    await sweepOnce(cleanup);
    expect(warnings.get("dirty")).toBe(expected);
  });

  it("skips running threads", async () => {
    const { cleanup, alive } = setUp([thread("busy", { status: "running" })]);
    await sweepOnce(cleanup);
    expect(alive.has("busy")).toBe(true);
  });

  it("deletes children together with their parent and runs the removal hooks", async () => {
    const { cleanup, alive, discarded } = setUp([
      thread("parent"),
      thread("child", { parentId: "parent", archivedAt: NOW }),
    ]);
    await sweepOnce(cleanup);
    expect(alive.size).toBe(0);
    expect(discarded.sort()).toEqual(["child", "parent"]);
  });

  it("stops the hourly timer and waits for the run in flight on stop", async () => {
    const { cleanup, alive } = setUp([thread("old")]);
    cleanup.start();
    await cleanup.stop();
    alive.set("later", thread("later"));
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS * 3);
    expect(alive.has("later")).toBe(true);
  });

  it("sweeps again every hour while started", async () => {
    const { cleanup, alive } = setUp([]);
    cleanup.start();
    alive.set("late", thread("late"));
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
    expect(alive.has("late")).toBe(false);
    await cleanup.stop();
  });
});

describe("deleteArchived", () => {
  it("deletes young threads too, keeps unmerged ones with a reason", async () => {
    const { cleanup, alive } = setUp([thread("young", { archivedAt: NOW - HOUR }), thread("dirty")], {
      dirty: ["a.txt"],
    });
    const result = await cleanup.deleteArchived({ force: false });
    expect(result.deleted).toEqual(["young"]);
    expect(result.kept).toEqual([{ id: "dirty", reason: "Uncommitted changes in pi/dirty" }]);
    expect(alive.has("dirty")).toBe(true);
  });

  it("deletes threads with unmerged work when forced", async () => {
    const { cleanup, alive } = setUp([thread("dirty")], { dirty: ["a.txt"] });
    const result = await cleanup.deleteArchived({ force: true });
    expect(result).toEqual({ deleted: ["dirty"], kept: [] });
    expect(alive.size).toBe(0);
  });

  it("blocks a thread that was clean at decide time but dirty at delete time", async () => {
    const calls = new Map<string, number>();
    const cleanThenDirty = async (item: ConversationSummary) => {
      const count = (calls.get(item.id) ?? 0) + 1;
      calls.set(item.id, count);
      return count === 1 ? [] : ["a.txt"];
    };
    const { cleanup, alive } = setUp([thread("late")], {}, cleanThenDirty);
    const result = await cleanup.deleteArchived({ force: false });
    expect(result.deleted).toEqual([]);
    expect(result.kept.map((item) => item.id)).toEqual(["late"]);
    expect(alive.has("late")).toBe(true);
  });
});
