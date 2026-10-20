import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ConversationSummary,
  type ConversationView,
  DEFAULT_RESOURCE_SETTINGS,
  type ProcessInfo,
} from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BangCommandDeps,
  entryOfThread,
  parseBangCommand,
  runBangCommand,
  stripBangPrefix,
} from "./bang-command";
import { createConversationsApi } from "./conversations-api";
import type { IndexedConversation } from "./harness/conversation-docs";
import type { ConversationStore } from "./harness/conversation-store";
import type { Notification } from "./harness/notification-submitter";
import { bashPath, DEFAULT_TIMEOUT_SECONDS } from "./harness/tools/bash";
import { createProcessService } from "./processes/process-service";
import {
  type ConversationHarness,
  openConversationHarness,
  startRequest,
} from "./test-support/conversation-harness";
import { openFauxWorld, setUpConversation, trackView, waitUntil } from "./test-support/faux-core";
import { useTempDir } from "./test-support/temp-dir";

const rejectsWithCode = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

describe("parseBangCommand", () => {
  it("runs `! ` plus a command", () => {
    expect(parseBangCommand("! ls")).toEqual({ kind: "command", command: "ls" });
    expect(parseBangCommand("  ! ls -la /tmp  ")).toEqual({ kind: "command", command: "ls -la /tmp" });
    expect(parseBangCommand("! /compact")).toEqual({ kind: "command", command: "/compact" });
  });

  it("keeps a multiline body", () => {
    expect(parseBangCommand("! echo hi\nbye")).toEqual({ kind: "command", command: "echo hi\nbye" });
  });

  it("treats `!` without a space as literal text", () => {
    for (const text of ["!ls", "![a](b)", "!= null", "!important", "!/compact", "hello", ""]) {
      expect(parseBangCommand(text)).toEqual({ kind: "literal" });
    }
  });

  it("strips server-side `!!` to a literal without exec", () => {
    expect(parseBangCommand("!!wow")).toEqual({ kind: "escaped", text: "!wow" });
    expect(parseBangCommand("!!!")).toEqual({ kind: "escaped", text: "!!" });
    expect(parseBangCommand("  !! x")).toEqual({ kind: "escaped", text: "  ! x" });
  });

  it("rejects a bare `!` as invalid_request", () => {
    for (const text of ["!", "! ", "  !  "]) {
      let error: unknown;
      try {
        parseBangCommand(text);
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toMatchObject({ code: "invalid_request" });
    }
  });
});

describe("stripBangPrefix", () => {
  it("strips `! ` for titling only", () => {
    expect(stripBangPrefix("! echo hi")).toBe("echo hi");
    expect(stripBangPrefix("![a](b)")).toBe("![a](b)");
    expect(stripBangPrefix("!!wow")).toBe("!!wow");
    expect(stripBangPrefix("hello")).toBe("hello");
  });
});

type StartRequest = Parameters<BangCommandDeps["processes"]["start"]>[0];

function fakeProcesses(impl?: (request: StartRequest) => Promise<never>) {
  return {
    start: vi.fn(async (request: StartRequest): Promise<ProcessInfo> => {
      if (impl) return impl(request);
      return { id: "proc-1" } as ProcessInfo;
    }),
    stop: vi.fn(async () => undefined),
    resourceSettings: () => DEFAULT_RESOURCE_SETTINGS,
  };
}

function fakeNotifications() {
  const sent: { conversationId: string; notification: Notification }[] = [];
  return {
    sent,
    notify: vi.fn(async (conversationId: string, notification: Notification) => {
      sent.push({ conversationId, notification });
    }),
  };
}

describe("runBangCommand", () => {
  let directory = "";
  const before: string[] = [];

  const trackDir = async () => {
    const dir = await mkdtemp(join(tmpdir(), "tau-bang-"));
    before.push(dir);
    return dir;
  };

  beforeEach(async () => {
    directory = await trackDir();
  });

  afterEach(async () => {
    await Promise.all(before.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const depsFor = (overrides: Partial<BangCommandDeps> = {}): BangCommandDeps => ({
    threads: {
      find: async () =>
        ({ workspace: { state: "ready", path: directory } }) as unknown as ConversationSummary,
    },
    processes: fakeProcesses(),
    notifications: fakeNotifications(),
    entryOf: async () => undefined,
    home: undefined,
    ...overrides,
  });

  it("spawns with the tool's shell, cwd, env and governed parity", async () => {
    const processes = fakeProcesses();
    const deps = depsFor({ home: "/home", entryOf: async () => undefined, processes });
    await runBangCommand(deps, "c1", "echo hi");
    expect(processes.start).toHaveBeenCalledTimes(1);
    const request = processes.start.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      conversationId: "c1",
      cwd: directory,
      command: "echo hi",
      shell: bashPath(),
      notifyOnExit: true,
    });
    expect(request?.env).toMatchObject({ TAU_THREAD_ID: "c1", TAU_HOME: "/home" });
    expect(request?.env.PATH?.startsWith(`${join("/home", "bin")}:`)).toBe(true);
    expect(request).not.toHaveProperty("governed");
  });

  it("marks the spawn governed when resource controls apply to the thread", async () => {
    const entry = {
      parentId: null,
      workspace: { mode: "checkout" },
    } as unknown as IndexedConversation;
    const processes = fakeProcesses();
    processes.resourceSettings = () => ({
      ...DEFAULT_RESOURCE_SETTINGS,
      levels: { main: "balanced", worktree: "off", subagent: "off" },
    });
    const deps = depsFor({ entryOf: async () => entry, processes });
    await runBangCommand(deps, "c1", "echo hi");
    expect(processes.start.mock.calls[0]?.[0]).toMatchObject({ governed: true, scope: "main" });
  });

  it("submits an app.notice and resolves when the spawn throws", async () => {
    const notifications = fakeNotifications();
    const deps = depsFor({
      notifications,
      processes: { ...fakeProcesses(), start: vi.fn(async () => Promise.reject(new Error("boom"))) },
    });
    await runBangCommand(deps, "c1", "echo hi");
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const [conversationId, notice] = notifications.notify.mock.calls[0] ?? [];
    expect(conversationId).toBe("c1");
    expect(notice?.kind).toBe("app.notice");
    expect(notice?.text).toContain("Command failed to start: boom");
  });

  it("never rejects when the workspace is gone after admission", async () => {
    const notifications = fakeNotifications();
    const deps = depsFor({
      notifications,
      threads: { find: async () => undefined },
    });
    await runBangCommand(deps, "c1", "echo hi");
    expect(deps.processes.start).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });
});

describe("conversations-api send with bang", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tau-bang-api-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const summaryFor = () =>
    ({ id: "1", workspace: { state: "ready", path: directory } }) as unknown as ConversationSummary;

  function makeApi(
    overrides: {
      store?: {
        modelOf?: ConversationStore["modelOf"];
        find?: ConversationStore["find"];
        send?: ConversationStore["send"];
      };
      start?: () => Promise<never>;
      titles?: { generateFor: (...args: unknown[]) => void };
    } = {},
  ) {
    const store = {
      modelOf: overrides.store?.modelOf ?? (async () => ({ provider: "faux", modelId: "faux-1" })),
      find: overrides.store?.find ?? (async () => summaryFor()),
      send:
        overrides.store?.send ??
        (async () => ({ projectId: "p1", admitted: true as const, titleText: "echo hi" })),
    } as unknown as ConversationStore;
    const processes = fakeProcesses(overrides.start);
    const notifications = fakeNotifications();
    const api = createConversationsApi({
      conversations: store,
      projects: {},
      provider: { models: { getModel: () => ({ input: [] }) } },
      settings: { get: async () => ({}) },
      titles: overrides.titles ?? { generateFor: () => undefined },
      status: {},
      workspaces: {},
      checkpoints: { snapshotBefore: async () => undefined },
      forker: {},
      harness: {},
      removal: {},
      archivedCleanup: {},
      changes: { emit: () => undefined },
      now: () => 1,
      closeClaudeCliThread: async () => undefined,
      bang: { processes, notifications, home: undefined },
    } as unknown as Parameters<typeof createConversationsApi>[0]);
    return { api, store, processes, notifications };
  }

  it("spawns for the admitted winner and titles from the stripped command", async () => {
    const generateFor = vi.fn();
    const { api, processes } = makeApi({ titles: { generateFor } });
    await api.send("1", { text: "! echo hi", requestId: "r1" });
    expect(processes.start).toHaveBeenCalledTimes(1);
    expect(generateFor).toHaveBeenCalledWith("1", "echo hi");
  });

  it("spawns for the admitted winner only", async () => {
    const { api, processes } = makeApi({
      store: { send: async () => ({ projectId: "p1", admitted: false }) },
    });
    await api.send("1", { text: "! echo hi", requestId: "r1" });
    expect(processes.start).not.toHaveBeenCalled();
  });

  it("validates before exec: no provider means no spawn call", async () => {
    const send = vi.fn(async () => ({ projectId: "p1", admitted: true as const }));
    const { api, processes } = makeApi({
      store: {
        modelOf: async () => {
          throw Object.assign(new Error("Connect a provider first."), { code: "no_provider" });
        },
        send,
      },
    });
    await rejectsWithCode(api.send("1", { text: "! echo hi", requestId: "r1" }), "no_provider");
    expect(send).not.toHaveBeenCalled();
    expect(processes.start).not.toHaveBeenCalled();
  });

  it("rejects a missing workspace before admission", async () => {
    const send = vi.fn(async () => ({ projectId: "p1", admitted: true as const }));
    const { api, processes } = makeApi({ store: { find: async () => undefined, send } });
    await rejectsWithCode(api.send("1", { text: "! echo hi", requestId: "r1" }), "not_found");
    expect(send).not.toHaveBeenCalled();
    expect(processes.start).not.toHaveBeenCalled();
  });

  it("spawn failure submits a notice and still resolves", async () => {
    const { api, notifications, processes } = makeApi({
      start: async () => Promise.reject(new Error("boom")),
    });
    await api.send("1", { text: "! echo hi", requestId: "r1" });
    expect(processes.start).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.sent[0]?.notification.text).toContain("Command failed to start: boom");
  });

  it("sends `!!` stripped as literal text without spawning", async () => {
    const send = vi.fn(async (_id: string, _input: { text: string }) => ({
      projectId: "p1",
      admitted: true as const,
    }));
    const { api, processes } = makeApi({ store: { send } });
    await api.send("1", { text: "!!wow", requestId: "r1" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toMatchObject({ text: "!wow" });
    expect(processes.start).not.toHaveBeenCalled();
  });

  it("rejects a bare `!` before admission", async () => {
    const send = vi.fn(async () => ({ projectId: "p1", admitted: true as const }));
    const { api, processes } = makeApi({ store: { send } });
    await rejectsWithCode(api.send("1", { text: "!", requestId: "r1" }), "invalid_request");
    expect(send).not.toHaveBeenCalled();
    expect(processes.start).not.toHaveBeenCalled();
  });
});

describe("entryOfThread", () => {
  it("returns undefined for non-numeric ids without touching the harness", async () => {
    const snapshot = vi.fn(async () => undefined);
    await expect(entryOfThread({ snapshot } as never, "nope")).resolves.toBeUndefined();
    expect(snapshot).not.toHaveBeenCalled();
  });
});

describe("stop reason threading", () => {
  let home = "";
  let cwd = "";
  const sent: Notification[] = [];
  const waitFor = async (check: () => boolean, what: string) => {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "tau-bang-home-"));
    cwd = await mkdtemp(join(tmpdir(), "tau-bang-cwd-"));
    sent.splice(0);
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it("a timeout stop carries stopReason into the exit notice text and data", async () => {
    const service = createProcessService({
      home,
      emitChange: () => undefined,
      stopGraceMs: 300,
      notifications: { notify: async (_id, notification) => void sent.push(notification) },
    });
    try {
      const info = await service.start({ conversationId: "c1", cwd, command: "sleep 30", name: "nap" });
      await service.stop(info.id, "timeout");
      await waitFor(() => sent.length === 1, "the exit notice");
      expect(sent[0]?.kind).toBe("app.process_exit");
      expect(sent[0]?.data).toMatchObject({ stopReason: "timeout", exitCode: null });
      expect(sent[0]?.text).toContain("Timed out after 120 s.");
    } finally {
      await service.stopAll();
    }
  });

  it("a natural exit carries no stopReason", async () => {
    const service = createProcessService({
      home,
      emitChange: () => undefined,
      stopGraceMs: 300,
      notifications: { notify: async (_id, notification) => void sent.push(notification) },
    });
    try {
      await service.start({ conversationId: "c1", cwd, command: "echo hi", name: "greet" });
      await waitFor(() => sent.length === 1, "the exit notice");
      expect(sent[0]?.data).toMatchObject({ exitCode: 0 });
      expect(sent[0]?.data).not.toHaveProperty("stopReason");
    } finally {
      await service.stopAll();
    }
  });

  it("bang kill timer constant matches the tool default", () => {
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(120);
  });
});

const userTexts = (view: ConversationView | null): string[] =>
  (view?.entries ?? []).flatMap((entry) => {
    if (entry.kind !== "pi.user") return [];
    const content = (entry.model?.[0] as { content?: unknown } | undefined)?.content;
    if (typeof content === "string") return [content];
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) =>
      typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
        ? [(part as { text?: unknown }).text].flatMap((text) => (typeof text === "string" ? [text] : []))
        : [],
    );
  });

describe("bang admission in the conversation store", () => {
  const tempDir = useTempDir();
  let world: ConversationHarness;

  beforeEach(async () => {
    world = await openConversationHarness(await tempDir());
  });

  afterEach(async () => {
    await world.close();
  });

  it("admits once per requestId", async () => {
    const { summary } = await world.store.start(startRequest(world, "hello", "start-1"));
    const first = await world.store.send(
      String(summary.id),
      { text: "! echo hi", requestId: "bang-1" },
      Date.now(),
      "steer",
    );
    expect(first).toMatchObject({ projectId: world.project.id, admitted: true });
    const loser = await world.store.send(
      String(summary.id),
      { text: "! echo hi", requestId: "bang-1" },
      Date.now(),
      "steer",
    );
    expect(loser).toMatchObject({ projectId: world.project.id, admitted: false });
    expect(loser).not.toHaveProperty("titleText");
  });
});

describe("bang commands on the real core", () => {
  const tempDir = useTempDir();

  it("stores `! cmd` verbatim", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { conversation } = await setUpConversation(world, "hello");
      const tracker = await trackView(world.core, conversation.id);
      await world.core.conversations.send(conversation.id, { text: "! echo hi", requestId: "bang-1" });
      await waitUntil(() => userTexts(tracker.view()).includes("! echo hi"), "the verbatim bang entry");
      await tracker.stop();
    } finally {
      await world.core.close();
    }
  });

  it("spawns once for concurrent and repeated sends with one requestId", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { conversation } = await setUpConversation(world, "hello");
      await Promise.all([
        world.core.conversations.send(conversation.id, { text: "! sleep 20", requestId: "bang-2" }),
        world.core.conversations.send(conversation.id, { text: "! sleep 20", requestId: "bang-2" }),
      ]);
      await world.core.conversations.send(conversation.id, { text: "! sleep 20", requestId: "bang-2" });
      const running = await world.core.processes.list(conversation.id);
      expect(running).toHaveLength(1);
      expect(running[0]?.command).toBe("! sleep 20".slice(2));
      await world.core.processes.stop(running[0]?.id ?? "");
    } finally {
      await world.core.close();
    }
  });

  it("stores `!!hi` as literal `!hi` without spawning", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { conversation } = await setUpConversation(world, "hello");
      const tracker = await trackView(world.core, conversation.id);
      await world.core.conversations.send(conversation.id, { text: "!!hi", requestId: "bang-3" });
      await waitUntil(() => userTexts(tracker.view()).includes("!hi"), "the stripped literal entry");
      expect(await world.core.processes.list(conversation.id)).toEqual([]);
      await tracker.stop();
    } finally {
      await world.core.close();
    }
  });

  it("rejects a bare `!`", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { conversation } = await setUpConversation(world, "hello");
      await rejectsWithCode(
        world.core.conversations.send(conversation.id, { text: "!", requestId: "bang-4" }),
        "invalid_request",
      );
    } finally {
      await world.core.close();
    }
  });
});
