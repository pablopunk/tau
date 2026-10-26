import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RESOURCE_SETTINGS, type ResourceSettings, type SandboxSettings } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResourceState } from "../../processes/governor/resource-state";
import { createProcessService, type ProcessService } from "../../processes/process-service";
import type { SpawnFn } from "../../processes/running-process";
import { ConversationDoc, type IndexedConversation } from "../conversation-docs";
import { createTauBashTool } from "./bash";
import { monitorToolFile } from "./monitor";
import { processStartToolFile } from "./process-start";
import type { ToolFileFactory, ToolServicesRef } from "./tool-file";

const SEATBELT = "/usr/bin/sandbox-exec";
const WORKTREE_AND_SUBAGENT_ONLY: SandboxSettings = { main: false, worktree: true, subagent: true };

let home: string;
let cwd: string;
const services: ProcessService[] = [];
const spawnedFiles: string[] = [];
const spawnedArgs: string[][] = [];

class HangingChild extends EventEmitter {
  readonly pid = 999983;
  readonly stdout = undefined;
  readonly stderr = undefined;
}

const hangingSpawn = ((file: string, args: string[]) => {
  spawnedFiles.push(file);
  spawnedArgs.push(args);
  return new HangingChild();
}) as unknown as SpawnFn;

const resources = (main: "off" | "balanced", worktree: "off" | "balanced" = "off"): ResourceSettings => ({
  ...DEFAULT_RESOURCE_SETTINGS,
  levels: { main, worktree, subagent: "off" },
});

const worktreeRoot = () => ({ kind: "worktree" as const, root: cwd });

function makeService(
  resourceSettings: ResourceSettings,
  sandbox: SandboxSettings,
  resolveSandboxRoot: () => ReturnType<typeof worktreeRoot> | undefined = worktreeRoot,
) {
  const service = createProcessService({
    home,
    emitChange: () => {},
    stopGraceMs: 50,
    nodeId: () => "test-node",
    resources: createResourceState(resourceSettings),
    spawn: hangingSpawn,
    sandbox,
    sandboxPlatform: "macos",
    sandboxBinaries: { sandboxExec: SEATBELT },
    resolveSandboxRoot,
  });
  services.push(service);
  return service;
}

type Execute = (args: unknown, api: unknown, context: unknown) => Promise<unknown>;
type ToolOf = { name: string; execute: Execute };

const entries = {
  main: { conversationId: 1, title: "t", createdAt: 0, updatedAt: 0, workspace: { mode: "checkout" } },
  worktree: { conversationId: 1, title: "t", createdAt: 0, updatedAt: 0, workspace: { mode: "worktree" } },
  subagent: { conversationId: 1, title: "t", createdAt: 0, updatedAt: 0, parentId: "9" },
};

type ThreadKind = keyof typeof entries;

function apiFor(kind: ThreadKind | "unknown", callId = "call-1") {
  const found = kind === "unknown" ? [] : [entries[kind] as unknown as IndexedConversation];
  return {
    conversationId: 1,
    callId,
    env: { cwd },
    output: () => {},
    retainedOutput: () => ({ text: "", truncated: false }),
    diagnostic: () => {},
    snapshot: async (token: unknown) =>
      token === ConversationDoc ? { projectId: "p" } : { conversations: found },
  };
}

const refOf = (service: ProcessService) =>
  ({ current: () => ({ processes: service }) }) as unknown as ToolServicesRef;

const toolFrom = (factory: ToolFileFactory, service: ProcessService, name: string): ToolOf => {
  const tools = (factory(refOf(service)).extension as unknown as { tools: ToolOf[] }).tools;
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
};

async function runBackgroundTool(tool: ToolOf, args: unknown, kind: ThreadKind | "unknown") {
  await tool.execute(args, apiFor(kind), {});
}

async function runBash(service: ProcessService, kind: ThreadKind | "unknown") {
  const bash = createTauBashTool({ services: refOf(service), prepare: () => {} }) as unknown as ToolOf;
  const abort = new AbortController();
  const pending = bash
    .execute({ command: "echo hi" }, apiFor(kind), { abortSignal: abort.signal })
    .catch((error: Error) => error);
  await vi.waitFor(() => expect(spawnedFiles.length).toBeGreaterThan(0));
  abort.abort();
  await pending;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tool-sandbox-home-"));
  cwd = await mkdtemp(join(tmpdir(), "tool-sandbox-cwd-"));
  spawnedFiles.length = 0;
  spawnedArgs.length = 0;
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()));
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("process_start sandbox scope", () => {
  const start = (service: ProcessService, kind: ThreadKind | "unknown") =>
    runBackgroundTool(toolFrom(processStartToolFile, service, "process_start"), { command: "echo hi" }, kind);

  it("sandboxes a worktree thread whose resource level is Off while main sandbox is Off", async () => {
    await start(makeService(resources("balanced"), WORKTREE_AND_SUBAGENT_ONLY), "worktree");
    expect(spawnedFiles).toEqual([SEATBELT]);
  });

  it("sandboxes a subagent thread whose resource level is Off while main sandbox is Off", async () => {
    await start(makeService(resources("balanced"), WORKTREE_AND_SUBAGENT_ONLY), "subagent");
    expect(spawnedFiles).toEqual([SEATBELT]);
  });

  it("sandboxes when every resource level is Off", async () => {
    await start(makeService(resources("off"), WORKTREE_AND_SUBAGENT_ONLY), "worktree");
    expect(spawnedFiles).toEqual([SEATBELT]);
  });

  it("leaves a main thread unsandboxed when only worktree and subagent are on", async () => {
    await start(makeService(resources("balanced"), WORKTREE_AND_SUBAGENT_ONLY), "main");
    expect(spawnedFiles).toHaveLength(1);
    expect(spawnedFiles).not.toContain(SEATBELT);
  });

  it("denies a thread it cannot resolve while any sandbox scope is on and no root resolves", async () => {
    const service = makeService(resources("off"), WORKTREE_AND_SUBAGENT_ONLY, () => undefined);
    await expect(start(service, "unknown")).rejects.toMatchObject({ code: "forbidden" });
    expect(spawnedFiles).toHaveLength(0);
  });

  it("runs a thread it cannot resolve plainly while every sandbox scope is off", async () => {
    await start(makeService(resources("off"), { main: false, worktree: false, subagent: false }), "unknown");
    expect(spawnedFiles).toHaveLength(1);
    expect(spawnedFiles).not.toContain(SEATBELT);
  });

  it.skipIf(process.platform !== "darwin")(
    "still governs a worktree thread whose resource level is on, inside the sandbox",
    async () => {
      await start(makeService(resources("off", "balanced"), WORKTREE_AND_SUBAGENT_ONLY), "worktree");
      expect(spawnedFiles).toEqual([SEATBELT]);
      expect(spawnedArgs[0]).toContain("/usr/sbin/taskpolicy");
    },
  );
});

describe("monitor sandbox scope", () => {
  const monitor = (service: ProcessService, kind: ThreadKind | "unknown") =>
    runBackgroundTool(
      toolFrom(monitorToolFile, service, "monitor"),
      { command: "echo hi", description: "d" },
      kind,
    );

  it("sandboxes a worktree thread whose resource level is Off while main sandbox is Off", async () => {
    await monitor(makeService(resources("balanced"), WORKTREE_AND_SUBAGENT_ONLY), "worktree");
    expect(spawnedFiles).toEqual([SEATBELT]);
  });

  it("leaves a main thread unsandboxed", async () => {
    await monitor(makeService(resources("balanced"), WORKTREE_AND_SUBAGENT_ONLY), "main");
    expect(spawnedFiles).toHaveLength(1);
    expect(spawnedFiles).not.toContain(SEATBELT);
  });
});

describe("bash sandbox scope", () => {
  it("sandboxes a worktree thread whose resource level is Off while main sandbox is Off", async () => {
    await runBash(makeService(resources("balanced"), WORKTREE_AND_SUBAGENT_ONLY), "worktree");
    expect(spawnedFiles[0]).toBe(SEATBELT);
  });

  it("sandboxes a subagent thread whose resource level is Off while main sandbox is Off", async () => {
    await runBash(makeService(resources("balanced"), WORKTREE_AND_SUBAGENT_ONLY), "subagent");
    expect(spawnedFiles[0]).toBe(SEATBELT);
  });

  it("leaves a main thread unsandboxed", async () => {
    await runBash(makeService(resources("balanced"), WORKTREE_AND_SUBAGENT_ONLY), "main");
    expect(spawnedFiles[0]).not.toBe(SEATBELT);
  });
});
