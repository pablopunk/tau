import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RESOURCE_SETTINGS, type ResourceSettings } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResourceState } from "../../processes/governor/resource-state";
import { sleep } from "../../processes/process-group";
import { createProcessService, type ProcessService } from "../../processes/process-service";
import { ConversationDoc } from "../conversation-docs";
import { createTauBashTool } from "./bash";
import type { ToolServicesRef } from "./tool-file";

let cwd: string;
let home: string;
const services: ProcessService[] = [];

const settings = (patch: Partial<ResourceSettings>): ResourceSettings => ({
  ...DEFAULT_RESOURCE_SETTINGS,
  levels: { main: "balanced", worktree: "balanced", subagent: "balanced" },
  ...patch,
});

function make(initial: ResourceSettings, memoryLimitMb?: number) {
  const service = createProcessService({
    home,
    emitChange: () => {},
    stopGraceMs: 300,
    graceMs: 300,
    resources: createResourceState(initial),
    ...(memoryLimitMb !== undefined && { memoryLimitMb }),
  } as Parameters<typeof createProcessService>[0]);
  services.push(service);
  return service;
}

type Execute = (args: unknown, api: unknown, context: unknown) => Promise<{ output?: { text: string }[] }>;

function bashOf(service: ProcessService) {
  const ref = { current: () => ({ processes: service }) } as unknown as ToolServicesRef;
  const tool = createTauBashTool({ services: ref, prepare: () => {} }) as unknown as { execute: Execute };
  const call = (command: string, callId: string, extra: { timeout?: number; signal?: AbortSignal } = {}) => {
    const api = {
      conversationId: 1,
      callId,
      env: { cwd },
      output: () => {},
      retainedOutput: () => ({ text: "", truncated: false }),
      diagnostic: () => {},
      snapshot: async (token: unknown) =>
        token === ConversationDoc
          ? { projectId: "p" }
          : { conversations: [{ conversationId: 1, title: "t", createdAt: 0, updatedAt: 0 }] },
    };
    return tool.execute({ command, ...(extra.timeout !== undefined && { timeout: extra.timeout }) }, api, {
      abortSignal: extra.signal,
    });
  };
  return call;
}

const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: Error) => error.message,
  );

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bash-res-home-"));
  cwd = await mkdtemp(join(tmpdir(), "bash-res-cwd-"));
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()));
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "darwin")("real memory kill (macOS polled sampler)", () => {
  it("stops a runaway command and its setsid escapee with the memory message", async () => {
    const service = make(settings({}), 150);
    const bash = bashOf(service);
    const python =
      "import os,sys,time\\n" +
      'if os.fork()==0:\\n os.setsid(); open("escapee.pid","w").write(str(os.getpid())); b=bytearray(300*2**20)\\n for i in range(0,len(b),4096): b[i]=1\\n time.sleep(120)\\n' +
      "time.sleep(60)";
    const result = await settle(bash(`printf '${python}' | python3 -I -`, "m"));
    expect(result).toBe(
      "Stopped: memory limit 150 MB exceeded (resource control is on: Main threads run at Balanced). " +
        "To allow more memory, set Main threads to Off in Settings → Agent, or split the work into smaller steps.",
    );
    await sleep(1500);
    const pid = Number(await readFile(join(cwd, "escapee.pid"), "utf8"));
    expect(pid).toBeGreaterThan(1);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 60_000);
});
