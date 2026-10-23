import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Change } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { createApprovals } from "../../approvals/approvals";
import type { Approvals } from "../../approvals/approvals-port";
import { createChangeEmitter } from "../../change-emitter";
import { useTempDir } from "../../test-support/temp-dir";
import {
  createNativePermissionBroker,
  isReadOnlyInsideWorkspace,
  type NativeNotice,
  type NativePermissionBroker,
  nativeApprovalSessionOf,
  redactSecrets,
  summarizeInput,
  withNativeThreads,
} from "./permissions";

const tempDir = useTempDir();
const THREAD = "7";
const BASH_ID = "toolu_bash_1";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Setup {
  readonly approvals: Approvals;
  readonly broker: NativePermissionBroker;
  readonly notices: NativeNotice[];
  readonly changes: Change[];
  readonly requested: string[];
  readonly pendingChanges: () => number;
}

interface SetupOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly threadExists?: () => Promise<boolean>;
  readonly recordNotice?: (notice: NativeNotice) => Promise<unknown>;
}

function setup(options: SetupOptions): Setup {
  const changes: Change[] = [];
  const emitter = createChangeEmitter();
  emitter.subscribe((change) => changes.push(change));
  const real = createApprovals({
    settings: {
      get: async () =>
        ({ claudeConnectors: { disabled: [], alwaysAllow: [], askBeforeWrites: true } }) as never,
      setClaudeConnectors: async () => undefined,
    },
    changes: emitter,
    conversationOfSession: withNativeThreads(async () => undefined),
  });
  const requested: string[] = [];
  const approvals: Approvals = {
    ...real,
    request: (request) => {
      requested.push(request.toolUseId);
      return real.request(request);
    },
  };
  const notices: NativeNotice[] = [];
  let changed = 0;
  const broker = createNativePermissionBroker({
    approvals,
    threadId: THREAD,
    cwd: options.cwd,
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    recordNotice: options.recordNotice ?? (async (notice) => void notices.push(notice)),
    onChange: () => {
      changed += 1;
    },
    ...(options.threadExists && { threadExists: options.threadExists }),
  });
  return { approvals, broker, notices, changes, requested, pendingChanges: () => changed };
}

const ask = (
  broker: NativePermissionBroker,
  toolName: string,
  input: Record<string, unknown>,
  toolUseID = BASH_ID,
  signal = new AbortController().signal,
) => broker.canUseTool(toolName, input, { signal, toolUseID });

describe("native approval session ids", () => {
  it("maps a native session back to its thread and leaves other sessions to the lookup", async () => {
    const lookup = withNativeThreads(async (id) => (id === "pi-1" ? "9" : undefined));
    expect(await lookup(nativeApprovalSessionOf("abc"))).toBe("abc");
    expect(await lookup("pi-1")).toBe("9");
    expect(await lookup("nope")).toBeUndefined();
  });
});

describe("read-only tools inside the workspace", () => {
  async function workspace() {
    const root = await tempDir();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "x");
    const outside = await tempDir();
    symlinkSync(outside, join(root, "escape"));
    return { root, outside };
  }

  it("allows Read, Glob and Grep on paths inside the workspace without asking", async () => {
    const { root } = await workspace();
    const inside = (tool: string, input: Record<string, unknown>) =>
      isReadOnlyInsideWorkspace(tool, input, root);
    expect(inside("Read", { file_path: join(root, "src", "a.ts") })).toBe(true);
    expect(inside("Read", { file_path: "src/new-file.ts" })).toBe(true);
    expect(inside("Glob", { pattern: "**/*.ts" })).toBe(true);
    expect(inside("Glob", { pattern: "*.ts", path: join(root, "src") })).toBe(true);
    expect(inside("Grep", { pattern: "/etc/passwd|\\.\\./", glob: "*.ts" })).toBe(true);
  });

  it("asks for everything that leaves the workspace or is not a read-only tool", async () => {
    const { root, outside } = await workspace();
    const inside = (tool: string, input: Record<string, unknown>) =>
      isReadOnlyInsideWorkspace(tool, input, root);
    expect(inside("Read", { file_path: "/etc/passwd" })).toBe(false);
    expect(inside("Read", { file_path: "../secret" })).toBe(false);
    expect(inside("Read", { file_path: "~/.ssh/id_rsa" })).toBe(false);
    expect(inside("Read", { file_path: join(root, "escape", "x") })).toBe(false);
    expect(inside("Read", { file_path: join(outside, "x") })).toBe(false);
    expect(inside("Read", { file_path: 5 })).toBe(false);
    expect(inside("Glob", { pattern: "/etc/*" })).toBe(false);
    expect(inside("Glob", { pattern: "../**" })).toBe(false);
    expect(inside("Glob", { pattern: "*", path: "/" })).toBe(false);
    expect(inside("Grep", { pattern: "x", glob: "../*" })).toBe(false);
    for (const tool of ["Bash", "Write", "Edit", "WebFetch", "NotebookEdit", "Task", "mcp__x__read"]) {
      expect(inside(tool, { file_path: join(root, "src", "a.ts"), command: "ls" })).toBe(false);
    }
  });

  it("never creates an approval for an allowed read", async () => {
    const { root } = await workspace();
    const world = setup({ cwd: root });

    const result = await ask(world.broker, "Read", { file_path: join(root, "src", "a.ts") }, "toolu_read");

    expect(result).toEqual({ behavior: "allow", updatedInput: { file_path: join(root, "src", "a.ts") } });
    expect(world.requested).toEqual([]);
    expect(world.approvals.list(THREAD)).toEqual([]);
    expect(world.notices).toEqual([]);
  });
});

describe("a tool that needs the user", () => {
  it("creates an approval keyed by the SDK tool use id and allows once the user allows it", async () => {
    const world = setup({ cwd: await tempDir() });
    const input = { command: "touch made.txt", description: "make a file" };

    const result = ask(world.broker, "Bash", input);
    await flush();

    expect(world.approvals.list(THREAD)).toMatchObject([
      { toolUseId: BASH_ID, conversationId: THREAD, server: "Claude Code", tool: "Bash", arguments: input },
    ]);
    expect(world.broker.pendingCount()).toBe(1);
    expect(world.changes).toContainEqual({ resource: "approvals", conversationId: THREAD });

    await world.approvals.decide(THREAD, BASH_ID, "allow");

    expect(await result).toEqual({ behavior: "allow", updatedInput: input });
    expect(world.approvals.list(THREAD)).toEqual([]);
    expect(world.broker.pendingCount()).toBe(0);
    expect(world.notices).toEqual([
      {
        type: "notice",
        key: `permission:${BASH_ID}`,
        code: "permission-allowed",
        text: "Permission allowed: Bash (command: touch made.txt)",
      },
    ]);
  });

  it("denies when the user denies and tells the model why", async () => {
    const world = setup({ cwd: await tempDir() });
    const result = ask(world.broker, "Write", { file_path: "/tmp/x", content: "c" });
    await flush();

    await world.approvals.decide(THREAD, BASH_ID, "deny");

    expect(await result).toEqual({ behavior: "deny", message: "The user denied this tool call." });
    expect(world.notices).toMatchObject([{ code: "permission-denied", key: `permission:${BASH_ID}` }]);
  });

  it("answers a duplicate decision with not_found and keeps the first outcome", async () => {
    const world = setup({ cwd: await tempDir() });
    const result = ask(world.broker, "Bash", { command: "ls" });
    await flush();
    await world.approvals.decide(THREAD, BASH_ID, "allow");

    await expect(world.approvals.decide(THREAD, BASH_ID, "deny")).rejects.toMatchObject({
      code: "not_found",
    });

    expect(await result).toMatchObject({ behavior: "allow" });
    expect(world.notices).toHaveLength(1);
  });

  it("asks once when the SDK repeats the same tool use id while it waits", async () => {
    const world = setup({ cwd: await tempDir() });
    const first = ask(world.broker, "Bash", { command: "ls" });
    const second = ask(world.broker, "Bash", { command: "ls" });
    await flush();

    await world.approvals.decide(THREAD, BASH_ID, "deny");

    expect(world.requested).toEqual([BASH_ID]);
    expect(await first).toEqual(await second);
    expect(world.notices).toHaveLength(1);
  });

  it("keeps two different tool use ids apart", async () => {
    const world = setup({ cwd: await tempDir() });
    const first = ask(world.broker, "Bash", { command: "one" }, "toolu_a");
    const second = ask(world.broker, "Bash", { command: "two" }, "toolu_b");
    await flush();
    expect(world.approvals.list(THREAD).map((approval) => approval.toolUseId)).toEqual([
      "toolu_a",
      "toolu_b",
    ]);

    await world.approvals.decide(THREAD, "toolu_b", "allow");
    await world.approvals.decide(THREAD, "toolu_a", "deny");

    expect(await first).toMatchObject({ behavior: "deny" });
    expect(await second).toMatchObject({ behavior: "allow" });
  });

  it("denies on timeout, clears the approval and ignores a late answer", async () => {
    const world = setup({ cwd: await tempDir(), timeoutMs: 40 });

    const result = await ask(world.broker, "Bash", { command: "ls" });

    expect(result).toMatchObject({ behavior: "deny", message: expect.stringContaining("in time") });
    expect(world.approvals.list(THREAD)).toEqual([]);
    expect(world.broker.pendingCount()).toBe(0);
    await expect(world.approvals.decide(THREAD, BASH_ID, "allow")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(world.notices).toMatchObject([
      { code: "permission-denied", text: expect.stringContaining("timed-out") },
    ]);
  });

  it("denies when the run is cancelled while waiting", async () => {
    const world = setup({ cwd: await tempDir() });
    const run = new AbortController();
    const result = ask(world.broker, "Bash", { command: "ls" }, BASH_ID, run.signal);
    await flush();

    run.abort();

    expect(await result).toMatchObject({ behavior: "deny", message: expect.stringContaining("cancelled") });
    expect(world.approvals.list(THREAD)).toEqual([]);
    expect(world.notices).toMatchObject([{ text: expect.stringContaining("cancelled") }]);
  });

  it("denies at once when the run was already cancelled", async () => {
    const world = setup({ cwd: await tempDir() });
    const run = new AbortController();
    run.abort();

    const result = await ask(world.broker, "Bash", { command: "ls" }, BASH_ID, run.signal);

    expect(result).toMatchObject({ behavior: "deny" });
    expect(world.requested).toEqual([]);
    expect(world.broker.pendingCount()).toBe(0);
  });

  it("denyAll denies every waiting approval and leaves none pending", async () => {
    const world = setup({ cwd: await tempDir() });
    const first = ask(world.broker, "Bash", { command: "one" }, "toolu_a");
    const second = ask(world.broker, "Write", { file_path: "/x" }, "toolu_b");
    await flush();

    world.broker.denyAll();

    expect(await first).toMatchObject({ behavior: "deny", message: expect.stringContaining("stopped") });
    expect(await second).toMatchObject({ behavior: "deny" });
    expect(world.approvals.list(THREAD)).toEqual([]);
    expect(world.approvals.hasPending(THREAD)).toBe(false);
    expect(world.broker.pendingCount()).toBe(0);
  });

  it("denies without asking when the thread no longer exists", async () => {
    const world = setup({ cwd: await tempDir(), threadExists: async () => false });

    const result = await ask(world.broker, "Bash", { command: "ls" });

    expect(result).toMatchObject({ behavior: "deny", message: expect.stringContaining("removed") });
    expect(world.requested).toEqual([]);
  });

  it("denies when the approval service itself cannot decide, never allows", async () => {
    const world = setup({ cwd: await tempDir() });
    const failing = createNativePermissionBroker({
      approvals: { ...world.approvals, request: async () => ({ allowed: false, message: "no thread" }) },
      threadId: THREAD,
      cwd: await tempDir(),
      recordNotice: async () => undefined,
    });

    expect(await ask(failing, "Bash", { command: "ls" })).toEqual({ behavior: "deny", message: "no thread" });
  });

  it("keeps the decision when the transcript cannot record it", async () => {
    const world = setup({
      cwd: await tempDir(),
      recordNotice: async () => {
        throw new Error("store closed");
      },
    });
    const result = ask(world.broker, "Bash", { command: "ls" });
    await flush();

    await world.approvals.decide(THREAD, BASH_ID, "allow");

    expect(await result).toMatchObject({ behavior: "allow" });
  });

  it("reports each change of the waiting set", async () => {
    const world = setup({ cwd: await tempDir() });
    const result = ask(world.broker, "Bash", { command: "ls" });
    await flush();
    const whileWaiting = world.pendingChanges();
    await world.approvals.decide(THREAD, BASH_ID, "allow");
    await result;

    expect(whileWaiting).toBe(1);
    expect(world.pendingChanges()).toBe(2);
  });
});

describe("AskUserQuestion", () => {
  it("is denied with a message that tells the model to ask in plain text, and creates no approval", async () => {
    const world = setup({ cwd: await tempDir() });

    const result = await ask(world.broker, "AskUserQuestion", { questions: [{ question: "Which one?" }] });

    expect(result).toMatchObject({ behavior: "deny", message: expect.stringContaining("plain text") });
    expect(world.requested).toEqual([]);
    expect(world.approvals.list(THREAD)).toEqual([]);
    expect(world.notices).toMatchObject([{ code: "permission-denied" }]);
  });
});

describe("the transcript summary", () => {
  it("redacts secrets and bounds the length", () => {
    const secret = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    expect(redactSecrets(`curl -H "Authorization: Bearer ${secret}" x`)).not.toContain(secret);
    expect(redactSecrets("API_KEY=hunter2hunter2 run")).toBe("API_KEY=[redacted] run");
    expect(redactSecrets("export TOKEN='abc123'")).toContain("[redacted]");
    expect(redactSecrets(`token ${secret}`)).not.toContain(secret);
    const long = summarizeInput({ command: `echo ${"a ".repeat(200)}` });
    expect(long.length).toBeLessThanOrEqual(122);
    expect(long.endsWith("…")).toBe(true);
    expect(summarizeInput({ command: "line one\nline two" })).toBe("command: line one line two");
    expect(summarizeInput({ other: 1, more: 2 })).toBe("fields: other, more");
  });

  it("never puts a secret from the input into the notice", async () => {
    const world = setup({ cwd: await tempDir() });
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const result = ask(world.broker, "Bash", { command: `git push https://x:${secret}@github.com/a/b` });
    await flush();
    await world.approvals.decide(THREAD, BASH_ID, "deny");
    await result;
    await sleep(0);

    expect(JSON.stringify(world.notices)).not.toContain(secret);
  });
});
