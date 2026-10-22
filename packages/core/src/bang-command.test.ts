import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
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
import type { Notification } from "./harness/notification-submitter";
import { bashPath, DEFAULT_TIMEOUT_SECONDS } from "./harness/tools/bash";
import { createProcessService } from "./processes/process-service";
import {
  type ConversationHarness,
  openConversationHarness,
  startRequest,
} from "./test-support/conversation-harness";
import { openFauxWorld, setUpConversation, trackView, waitUntil } from "./test-support/faux-core";
import type { Harness } from "@earendil-works/pi-durable";
import { admitAndDispatchBang, recoverBangs } from "./bang-command";
import { legacyWorkspace } from "./harness/conversation-index";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./harness/open";
import { createConversationStore } from "./harness/conversation-store";
import { harnessNotificationSubmitter } from "./harness/notification-submitter";
import type { NotificationSubmitter } from "./harness/notification-submitter";
import { createAgentRegistry } from "./harness/registry";
import { createFauxSetup } from "./testing/faux-provider";
import { createUploadStore } from "./upload-store";
import type { UploadStore } from "./upload-store";
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
    submitWrite: vi.fn(async () => undefined),
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
    await expect(runBangCommand(deps, "c1", "echo hi")).resolves.toBe(true);
    expect(processes.start).toHaveBeenCalledTimes(1);
    const request = processes.start.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      conversationId: "c1",
      cwd: directory,
      command: "echo hi",
      shell: bashPath(),
      origin: "bang",
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

  it("submits an app.notice and reports failure when the spawn throws", async () => {
    const notifications = fakeNotifications();
    const deps = depsFor({
      notifications,
      processes: { ...fakeProcesses(), start: vi.fn(async () => Promise.reject(new Error("boom"))) },
    });
    await expect(runBangCommand(deps, "c1", "echo hi")).resolves.toBe(false);
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
    await expect(runBangCommand(deps, "c1", "echo hi")).resolves.toBe(false);
    expect(deps.processes.start).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
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
      notifications: {
        notify: async (_id, notification) => void sent.push(notification),
        submitWrite: async () => undefined,
      },
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
      notifications: {
        notify: async (_id, notification) => void sent.push(notification),
        submitWrite: async () => undefined,
      },
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
    const first = await world.store.send(String(summary.id), { text: "hello again", requestId: "bang-1" }, Date.now(), "steer");
    expect(first).toMatchObject({ projectId: world.project.id, admitted: true });
    const loser = await world.store.send(String(summary.id), { text: "hello again", requestId: "bang-1" }, Date.now(), "steer");
    expect(loser).toMatchObject({ projectId: world.project.id, admitted: false });
    expect(loser).not.toHaveProperty("titleText");
  });
});

const bangRows = (view: ConversationView | null) =>
  (view?.entries ?? []).filter((entry) => entry.kind === "app.bang");
const exitRows = (view: ConversationView | null) =>
  (view?.entries ?? []).filter((entry) => entry.kind === "app.process_exit");
const noticeRows = (view: ConversationView | null) =>
  (view?.entries ?? []).filter((entry) => entry.kind === "app.notice");
const assistantRows = (view: ConversationView | null) =>
  (view?.entries ?? []).filter((entry) => entry.kind === "pi.assistant");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const runExec = promisify(execFile);

async function runGit(command: string, cwd: string, args: readonly string[] = []) {
  await runExec("git", [command, ...args], { cwd });
  await runExec("git", ["config", "user.email", "tau@test"], { cwd }).catch(() => undefined);
  await runExec("git", ["config", "user.name", "tau"], { cwd }).catch(() => undefined);
}

async function waitForAsync(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

const modelTextOf = (entry: { model?: unknown }): string => {
  const content = (entry.model as Array<{ content?: unknown }> | undefined)?.[0]?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");
};

describe("bang commands on the real core", () => {
  const tempDir = useTempDir();

  it("admits `! cmd` display-only: one execution, one output, never as model text", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { conversation } = await setUpConversation(world, "hello");
      const before = await trackView(world.core, conversation.id);
      const answersBefore = assistantRows(before.view()).length;
      await before.stop();
      const tracker = await trackView(world.core, conversation.id);
      await world.core.conversations.send(conversation.id, { text: "! echo hi", requestId: "bang-1" });
      await waitUntil(() => exitRows(tracker.view()).length === 1, "the bang exit");
      // Exactly one display row carrying the stripped command ...
      expect(bangRows(tracker.view())).toHaveLength(1);
      expect(bangRows(tracker.view())[0]?.data).toMatchObject({ command: "echo hi" });
      // ... and the model learns it only from the exit, prefixed with the command and its origin ...
      const [exit] = exitRows(tracker.view());
      expect(exit?.data).toMatchObject({ command: "echo hi", exitCode: 0, origin: "bang" });
      expect(modelTextOf(exit ?? {})).toMatch(/^You ran: echo hi\n/);
      expect(modelTextOf(exit ?? {})).toContain("hi");
      // ... never as `!` model text, and the exit starts no run when idle.
      expect(userTexts(tracker.view()).some((text) => text.includes("! echo hi"))).toBe(false);
      expect(userTexts(tracker.view()).some((text) => text.includes("!"))).toBe(false);
      expect(assistantRows(tracker.view())).toHaveLength(answersBefore);
      await tracker.stop();
    } finally {
      await world.core.close();
    }
  });

  it("a new bang succeeds after the previous one exits", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { conversation } = await setUpConversation(world, "hello");
      const tracker = await trackView(world.core, conversation.id);
      await world.core.conversations.send(conversation.id, { text: "! echo one", requestId: "bang-2a" });
      await waitUntil(() => exitRows(tracker.view()).length === 1, "the first exit");
      await world.core.conversations.send(conversation.id, { text: "! echo two", requestId: "bang-2b" });
      await waitUntil(() => exitRows(tracker.view()).length === 2, "the second exit");
      expect(bangRows(tracker.view())).toHaveLength(2);
      await tracker.stop();
    } finally {
      await world.core.close();
    }
  });

  it("refuses a second bang while one runs: no row, then runs after the exit", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { conversation } = await setUpConversation(world, "hello");
      const tracker = await trackView(world.core, conversation.id);
      await world.core.conversations.send(conversation.id, { text: "! sleep 30", requestId: "bang-3a" });
      await waitForAsync(async () => (await world.core.processes.list(conversation.id)).length === 1, "the bang to run");
      await rejectsWithCode(
        world.core.conversations.send(conversation.id, { text: "! echo hi", requestId: "bang-3b" }),
        "invalid_request",
      );
      expect(await world.core.processes.list(conversation.id)).toHaveLength(1);
      expect(bangRows(tracker.view())).toHaveLength(1);
      const [running] = await world.core.processes.list(conversation.id);
      await world.core.processes.stop(running?.id ?? "");
      await waitForAsync(async () => (await world.core.processes.list(conversation.id)).length === 0, "the stop");
      await world.core.conversations.send(conversation.id, { text: "! echo hi", requestId: "bang-3c" });
      await waitUntil(() => exitRows(tracker.view()).length === 1, "the exit");
      await tracker.stop();
    } finally {
      await world.core.close();
    }
  });

  it("a first-message `!` spawns instead of landing as model text", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { project } = await setUpConversation(world, "hello");
      const summary = await world.core.conversations.start({
        projectId: project.id,
        text: "! echo first",
        requestId: "bang-first-1",
      });
      const tracker = await trackView(world.core, summary.id);
      await waitUntil(() => exitRows(tracker.view()).length === 1, "the first-message exit");
      expect(bangRows(tracker.view())).toHaveLength(1);
      expect(bangRows(tracker.view())[0]?.data).toMatchObject({ command: "echo first" });
      expect(userTexts(tracker.view()).some((text) => text.includes("! echo first"))).toBe(false);
      await tracker.stop();
    } finally {
      await world.core.close();
    }
  });

  it("skips the snapshot checkpoint on bang sends but keeps it for plain ones", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { conversation, project } = await setUpConversation(world, "hello");
      await runGit("init", project.path);
      await world.core.conversations.send(conversation.id, { text: "plain hello", requestId: "cp-plain" });
      await world.core.conversations.send(conversation.id, { text: "! echo hi", requestId: "cp-bang" });
      const checkpoints = await world.core.conversations.checkpoints(conversation.id);
      const before = checkpoints.filter((checkpoint) => checkpoint.kind === "before");
      expect(before.some((checkpoint) => checkpoint.requestId === "cp-plain")).toBe(true);
      expect(before.some((checkpoint) => checkpoint.requestId === "cp-bang")).toBe(false);
      expect(checkpoints.some((checkpoint) => checkpoint.requestId === "cp-bang")).toBe(false);
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

  it("rejects attachments on `!` instead of dropping them silently", async () => {
    const world = await openFauxWorld(await tempDir(), () => 1);
    try {
      const { conversation } = await setUpConversation(world, "hello");
      await rejectsWithCode(
        world.core.conversations.send(conversation.id, {
          text: "! echo hi",
          files: [{ name: "n.txt", path: "uploads/n.txt", size: 1 }],
          requestId: "bang-files",
        }),
        "invalid_request",
      );
      const tracker = await trackView(world.core, conversation.id);
      expect(bangRows(tracker.view())).toHaveLength(0);
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

describe("bang restart recovery", () => {
  const tempDir = useTempDir();

  interface BangWorld {
    readonly dir: string;
    readonly harness: import("@earendil-works/pi-durable").Harness;
    readonly store: import("./harness/conversation-store").ConversationStore;
    readonly processes: import("./processes/process-service").ProcessService;
    readonly notifications: import("./harness/notification-submitter").NotificationSubmitter;
    readonly uploads: import("./upload-store").UploadStore;
    close(): Promise<void>;
  }

  const FAUX_MODEL = { provider: "faux", modelId: "faux-1" };

  async function openBangWorld(dir: string): Promise<BangWorld> {
    const harness = await openAgentHarness({
      storage: await openSqliteStorage(join(dir, "agent.sqlite")),
      models: createFauxSetup().models,
      registry: createAgentRegistry(),
    });
    const uploads = createUploadStore({ now: Date.now, root: join(dir, "uploads") });
    const store = createConversationStore(harness, async () => dir, { uploads });
    const notifications = harnessNotificationSubmitter(harness);
    const processes = createProcessService({
      home: dir,
      notifications,
      emitChange: () => undefined,
      stopGraceMs: 300,
    });
    return {
      dir,
      harness,
      store,
      processes,
      notifications,
      uploads,
      close: () => harness.close(BACKGROUND),
    };
  }

  const bangDepsFor = (world: BangWorld) => ({
    harness: world.harness,
    threads: world.store,
    uploads: world.uploads,
    processes: world.processes,
    notifications: world.notifications,
    home: world.dir,
    entryOf: (conversationId: string) => entryOfThread(world.harness, conversationId),
  });

  async function startIdleThread(world: BangWorld, requestId: string) {
    const { summary } = await world.store.start({
      project: {
        id: "p1",
        name: "main",
        path: world.dir,
        createdAt: 0,
        kind: "folder",
        status: "ready",
        isGitRepo: false,
      },
      model: FAUX_MODEL,
      thinkingLevel: "off",
      input: { text: "hello", requestId },
      workspace: legacyWorkspace(world.dir),
      now: Date.now(),
    });
    const conversation = await world.harness.conversation(Number(summary.id) as never, BACKGROUND);
    await conversation?.waitForIdle(BACKGROUND);
    return summary;
  }

  async function transcriptOf(world: BangWorld, id: string) {
    const conversation = await world.harness.conversation(Number(id) as never, BACKGROUND);
    const { entries } = await conversation!.context(BACKGROUND);
    return entries;
  }

  async function waitForAsync(condition: () => Promise<boolean>, what: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await sleep(25);
    }
  }

  it("a marked bang without an exit gets an interruption notice and never replays", async () => {
    const dir = await tempDir();
    const first = await openBangWorld(dir);
    let threadId = "";
    try {
      const summary = await startIdleThread(first, "restart-1");
      threadId = summary.id;
      await admitAndDispatchBang(bangDepsFor(first), summary.id, { text: "! sleep 30", requestId: "restart-bang" }, Date.now());
      await waitForAsync(async () => (await first.processes.list(summary.id)).length === 1, "the bang to run");
    } finally {
      await first.close();
    }
    // A fresh boot: the stale group is reaped, then the sweep owns the marker.
    const second = await openBangWorld(dir);
    try {
      await second.processes.reapStaleAtStartup();
      expect(await second.processes.list(threadId)).toEqual([]);
      const result = await recoverBangs(bangDepsFor(second));
      expect(result).toMatchObject({ redispatched: 0, interrupted: 1 });
      // Never re-run: no process, still exactly one bang row, one interruption notice.
      expect(await second.processes.list(threadId)).toEqual([]);
      const entries = await transcriptOf(second, threadId);
      expect(entries.filter((entry) => entry.kind === "app.bang")).toHaveLength(1);
      const notices = entries.filter((entry) => entry.kind === "app.notice");
      expect(notices.length).toBeGreaterThan(0);
      expect(JSON.stringify(notices.at(-1)?.data)).toContain("was interrupted by a restart");
    } finally {
      await second.close();
    }
  });

  it("a marked bang with an exit is silently dropped: completed-and-pruned never replays", async () => {
    const dir = await tempDir();
    const first = await openBangWorld(dir);
    let threadId = "";
    try {
      const summary = await startIdleThread(first, "restart-2");
      threadId = summary.id;
      await admitAndDispatchBang(bangDepsFor(first), summary.id, { text: "! echo hi", requestId: "restart-done" }, Date.now());
      await waitForAsync(
        async () =>
          (await first.processes.list(summary.id)).length === 0 &&
          (await transcriptOf(first, summary.id)).some((entry) => entry.kind === "app.process_exit"),
        "the bang to exit",
      );
    } finally {
      await first.close();
    }
    const second = await openBangWorld(dir);
    try {
      await second.processes.reapStaleAtStartup();
      const before = (await transcriptOf(second, threadId)).filter((entry) => entry.kind === "app.notice").length;
      const result = await recoverBangs(bangDepsFor(second));
      expect(result).toMatchObject({ redispatched: 0, interrupted: 0 });
      expect(await second.processes.list(threadId)).toEqual([]);
      const entries = await transcriptOf(second, threadId);
      expect(entries.filter((entry) => entry.kind === "app.bang")).toHaveLength(1);
      expect(entries.filter((entry) => entry.kind === "app.notice")).toHaveLength(before);
    } finally {
      await second.close();
    }
  });

  it("an unmarked bang is dispatched exactly once, then owned by its marker", async () => {
    const dir = await tempDir();
    const world = await openBangWorld(dir);
    try {
      const summary = await startIdleThread(world, "restart-3");
      // A crash between admission and the marker: the row exists, the marker does not.
      const conversation = await world.harness.conversation(Number(summary.id) as never, BACKGROUND);
      await conversation!.submit(
        { type: "write", entry: { kind: "app.bang", data: { command: "echo direct" } }, requestId: "unmarked-1" },
        BACKGROUND,
      );
      const first = await recoverBangs(bangDepsFor(world));
      expect(first.redispatched).toBe(1);
      await waitForAsync(
        async () =>
          (await world.processes.list(summary.id)).length === 0 &&
          (await transcriptOf(world, summary.id)).some((entry) => entry.kind === "app.process_exit"),
        "the re-dispatched bang to exit",
      );
      // Now marked with an exit: silent, no second spawn.
      const second = await recoverBangs(bangDepsFor(world));
      expect(second).toMatchObject({ redispatched: 0, interrupted: 0 });
      const entries = await transcriptOf(world, summary.id);
      expect(entries.filter((entry) => entry.kind === "app.bang")).toHaveLength(1);
      expect(entries.filter((entry) => entry.kind === "app.process_exit")).toHaveLength(1);
    } finally {
      await world.close();
    }
  });
});
