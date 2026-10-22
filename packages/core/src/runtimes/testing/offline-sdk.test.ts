import { execFile } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Options, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectToolResult,
  type FakeAnthropicServer,
  type RecordedMessage,
  type ScriptedTurn,
  startFakeAnthropicServer,
  toolResultsIn,
  toolResultText,
} from "./fake-anthropic-server";
import {
  childEnvironment,
  createOfflineWorld,
  FAKE_API_KEY,
  listTree,
  type OfflineWorld,
  sandboxExecAvailable,
  sandboxedSpawns,
} from "./offline-sandbox";

const FIXTURE_TEXT = "tau-offline-fixture-text-7f3a";
const READ_ID = "toolu_fake_read_0001";
const FINAL_TEXT = "The file says: tau-offline-fixture-text-7f3a. (scripted)";
const RESUMED_TEXT = "Resumed against the fake. (scripted)";
const PROMPT = "Please read fixture.txt and tell me what it says.";
const RESUME_PROMPT = "Continue from where you were.";
const MODEL = "claude-sonnet-4-5";

const transcriptsOf = (world: OfflineWorld): string =>
  listTree(world.home)
    .filter((entry) => entry.includes(".jsonl"))
    .map((entry) => readFileSync(join(world.home, entry.replace(/ \(\d+B\)$/, "")), "utf8"))
    .join("\n");

const execFileAsync = promisify(execFile);

interface Exited {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sandboxed(world: OfflineWorld, command: string, args: string[]): Promise<Exited> {
  try {
    const { stdout, stderr } = await execFileAsync("/usr/bin/sandbox-exec", [
      "-f",
      world.profile,
      command,
      ...args,
    ]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Run {
  readonly world: OfflineWorld;
  readonly server: FakeAnthropicServer;
  readonly spawns: ReturnType<typeof sandboxedSpawns>;
}

async function startRun(script: readonly ScriptedTurn[], world?: OfflineWorld): Promise<Run> {
  const ownedWorld = world ?? createOfflineWorld(FIXTURE_TEXT);
  if (!world) cleanups.push(() => rmSync(ownedWorld.root, { recursive: true, force: true }));
  const server = await startFakeAnthropicServer({ apiKey: FAKE_API_KEY, script, model: MODEL });
  cleanups.push(() => server.close());
  const spawns = sandboxedSpawns(ownedWorld, server.url);
  cleanups.push(() => spawns.killAllTrees());
  return { world: ownedWorld, server, spawns };
}

const readTurn = (world: OfflineWorld): ScriptedTurn => ({
  blocks: [{ type: "tool_use", id: READ_ID, name: "Read", input: { file_path: world.fixturePath } }],
});

const finalTurn = (text: string, validate?: ScriptedTurn["validate"]): ScriptedTurn => ({
  blocks: [{ type: "text", text }],
  ...(validate && { validate }),
});

function optionsOf(run: Run, extra: Partial<Options> = {}): Options {
  return {
    model: MODEL,
    cwd: run.world.cwd,
    systemPrompt: "You are a test agent.",
    title: "offline spike",
    tools: ["Read"],
    allowedTools: ["Read"],
    permissionMode: "dontAsk",
    settingSources: [],
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
    includePartialMessages: true,
    env: childEnvironment(run.world, run.server.url),
    spawnClaudeCodeProcess: run.spawns.spawn,
    ...extra,
  };
}

interface Outcome {
  readonly sessionId: string | null;
  readonly resultText: string | null;
  readonly assistantTexts: string[];
  readonly startedAfterMs: number;
  readonly totalMs: number;
}

async function drain(messages: AsyncIterable<SDKMessage>, startedAt: number): Promise<Outcome> {
  let sessionId: string | null = null;
  let resultText: string | null = null;
  let firstMessageAt: number | null = null;
  const assistantTexts: string[] = [];
  for await (const message of messages) {
    firstMessageAt ??= Date.now();
    if ("session_id" in message && typeof message.session_id === "string") sessionId ??= message.session_id;
    if (message.type === "assistant")
      for (const block of message.message.content) if (block.type === "text") assistantTexts.push(block.text);
    if (message.type === "result" && message.subtype === "success") resultText = message.result;
  }
  return {
    sessionId,
    resultText,
    assistantTexts,
    startedAfterMs: (firstMessageAt ?? Date.now()) - startedAt,
    totalMs: Date.now() - startedAt,
  };
}

const failureContext = (run: Run) =>
  `last=${JSON.stringify(run.server.messageRequests.at(-1)?.messages.at(-1))}\nviolations=${JSON.stringify(run.server.violations)}\nrequests=${run.server.requests
    .map((request) => `${request.method} ${request.path}`)
    .join(", ")}\nstderr=${run.spawns.stderr().slice(-2000)}`;

async function waitForTranscript(world: OfflineWorld, needle: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!transcriptsOf(world).includes(needle)) {
    if (Date.now() > deadline) throw new Error(`the SDK transcript never contained ${needle}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const describeMessage = (message: RecordedMessage): string => {
  if (typeof message.content === "string") return `${message.role}:text`;
  const kinds = (message.content as { type: string; name?: string }[]).map((block) =>
    block.type === "tool_use" ? `tool_use(${block.name})` : block.type,
  );
  return `${message.role}:[${kinds.join(",")}]`;
};

const textOfMessage = (message: RecordedMessage): string => JSON.stringify(message.content);

describe.skipIf(!sandboxExecAvailable())(
  "real Claude Agent SDK against a fake Anthropic API, offline",
  () => {
    it("contains the child: loopback works, everything else is denied", async () => {
      const run = await startRun([]);
      const curl = (url: string) =>
        sandboxed(run.world, "/usr/bin/curl", [
          "-sS",
          "-m",
          "5",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          url,
        ]);
      expect((await curl(`${run.server.url}/v1/ping`)).stdout).toBe("401");
      expect((await curl("http://192.0.2.1/")).code).not.toBe(0);
      const outside = await sandboxed(run.world, "/bin/sh", [
        "-c",
        "echo x > /private/tmp/tau-offline-outside-probe",
      ]);
      expect(outside.code).not.toBe(0);
      expect(outside.stderr).toContain("Operation not permitted");
      const realHome = await sandboxed(run.world, "/bin/ls", [process.env.HOME ?? "/Users"]);
      expect(realHome.code).not.toBe(0);
    });

    it("runs a native Read tool turn with exactly two API requests", async () => {
      const world = createOfflineWorld(FIXTURE_TEXT);
      cleanups.push(() => rmSync(world.root, { recursive: true, force: true }));
      const run = await startRun(
        [readTurn(world), finalTurn(FINAL_TEXT, expectToolResult(READ_ID, FIXTURE_TEXT))],
        world,
      );
      const homeBefore = listTree(world.home);

      const startedAt = Date.now();
      const sdkQuery = query({ prompt: PROMPT, options: optionsOf(run) });
      cleanups.push(() => sdkQuery.close());
      const outcome = await drain(sdkQuery, startedAt);

      const homeAfter = listTree(world.home);
      console.info(
        `[offline-sdk] first message after ${outcome.startedAfterMs}ms, total ${outcome.totalMs}ms\n` +
          `[offline-sdk] home before: ${homeBefore.length} entries; after (${homeAfter.length}):\n${homeAfter.join("\n")}\n` +
          `[offline-sdk] requests: ${run.server.requests.map((r) => `${r.method} ${r.path}`).join(" | ")}\n` +
          `[offline-sdk] request 2 messages: ${run.server.messageRequests[1]?.messages.map(describeMessage).join(" -> ")}`,
      );

      expect(run.server.violations, failureContext(run)).toEqual([]);
      expect(outcome.resultText, failureContext(run)).toBe(FINAL_TEXT);
      expect(outcome.assistantTexts).toContain(FINAL_TEXT);
      expect(run.server.messageRequests).toHaveLength(2);
      expect(run.server.requests.filter((request) => !request.keyWasFake)).toEqual([]);
      expect(run.server.requests.every((request) => request.keyHeader !== null)).toBe(true);
      const results = toolResultsIn(run.server.messageRequests[1]?.messages.at(-1));
      expect(results).toHaveLength(1);
      expect(results[0]?.tool_use_id).toBe(READ_ID);
      expect(toolResultText(results[0] as (typeof results)[number])).toContain(FIXTURE_TEXT);
      expect(homeAfter.filter((entry) => !entry.startsWith(".claude/") && entry !== ".claude/")).toEqual([]);
      expect(listTree(world.cwd)).toEqual([`fixture.txt (${FIXTURE_TEXT.length + 1}B)`]);
    });
  },
);

interface Interruption {
  readonly firstTurns: readonly ScriptedTurn[];
  readonly tools: string[];
  /** Text that must be in the SDK transcript before the child is killed. */
  readonly persistedBeforeKill: string;
}

interface Recovery {
  readonly sessionId: string;
  readonly resumedSessionId: string | null;
  readonly resultText: string | null;
  readonly history: readonly RecordedMessage[];
  readonly firstRun: Run;
  readonly secondRun: Run;
}

async function killMidTurnThenResume(world: OfflineWorld, interruption: Interruption): Promise<Recovery> {
  const firstRun = await startRun(interruption.firstTurns, world);
  const interrupted = query({
    prompt: PROMPT,
    options: optionsOf(firstRun, { tools: interruption.tools, allowedTools: interruption.tools }),
  });
  cleanups.push(() => interrupted.close());
  let sessionId: string | null = null;
  const collecting = (async () => {
    try {
      for await (const message of interrupted)
        if ("session_id" in message && typeof message.session_id === "string")
          sessionId ??= message.session_id;
    } catch {
      /* the child is killed on purpose */
    }
  })();
  await firstRun.server.messageRequestArrived(interruption.firstTurns.length);
  await waitForTranscript(world, interruption.persistedBeforeKill);
  firstRun.spawns.killNewestTree();
  await collecting;
  expect(sessionId, failureContext(firstRun)).not.toBeNull();
  expect(firstRun.server.violations, failureContext(firstRun)).toEqual([]);

  const secondRun = await startRun([finalTurn(RESUMED_TEXT)], world);
  const resumed = query({
    prompt: RESUME_PROMPT,
    options: optionsOf(secondRun, { resume: sessionId as unknown as string }),
  });
  cleanups.push(() => resumed.close());
  const outcome = await drain(resumed, Date.now());
  return {
    sessionId: sessionId as unknown as string,
    resumedSessionId: outcome.sessionId,
    resultText: outcome.resultText,
    history: secondRun.server.messageRequests[0]?.messages ?? [],
    firstRun,
    secondRun,
  };
}

const historyText = (history: readonly RecordedMessage[]): string => history.map(textOfMessage).join("\n");

const BASH_ID = "toolu_fake_bash_0001";

describe.skipIf(!sandboxExecAvailable())("abrupt session recovery with the real SDK, offline", () => {
  it("resumes after the child is killed while the model answer is pending", async () => {
    const world = createOfflineWorld(FIXTURE_TEXT);
    cleanups.push(() => rmSync(world.root, { recursive: true, force: true }));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recovery = await killMidTurnThenResume(world, {
      firstTurns: [readTurn(world), { ...finalTurn("never delivered"), holdResponseUntil: held }],
      tools: ["Read"],
      persistedBeforeKill: FIXTURE_TEXT,
    });
    release();

    console.info(
      `[offline-sdk] pending-answer kill: resumed history = ${recovery.history.map(describeMessage).join(" -> ")}\n` +
        `[offline-sdk] pending-answer kill: tail = ${JSON.stringify(recovery.history.slice(3))}`,
    );
    expect(recovery.secondRun.server.violations, failureContext(recovery.secondRun)).toEqual([]);
    expect(recovery.resultText, failureContext(recovery.secondRun)).toBe(RESUMED_TEXT);
    expect(recovery.secondRun.server.messageRequests).toHaveLength(1);
    expect(recovery.resumedSessionId).toBe(recovery.sessionId);
    const text = historyText(recovery.history);
    for (const expected of [PROMPT, READ_ID, FIXTURE_TEXT, RESUME_PROMPT]) expect(text).toContain(expected);
  });

  it("resumes after the child is killed while a tool call is still running", async () => {
    const world = createOfflineWorld(FIXTURE_TEXT);
    cleanups.push(() => rmSync(world.root, { recursive: true, force: true }));
    const slowTool: ScriptedTurn = {
      blocks: [
        { type: "tool_use", id: BASH_ID, name: "Bash", input: { command: "sleep 60", description: "wait" } },
      ],
    };
    const recovery = await killMidTurnThenResume(world, {
      firstTurns: [slowTool],
      tools: ["Bash"],
      persistedBeforeKill: BASH_ID,
    });

    const interrupted = recovery.history.flatMap((message) => toolResultsIn(message));
    console.info(
      `[offline-sdk] running-tool kill: resumed history = ${recovery.history.map(describeMessage).join(" -> ")}\n` +
        `[offline-sdk] running-tool kill: tool_results = ${JSON.stringify(interrupted)}\n` +
        `[offline-sdk] running-tool kill: tail = ${JSON.stringify(recovery.history.slice(3))}`,
    );
    expect(recovery.secondRun.server.violations, failureContext(recovery.secondRun)).toEqual([]);
    expect(recovery.resultText, failureContext(recovery.secondRun)).toBe(RESUMED_TEXT);
    expect(recovery.secondRun.server.messageRequests).toHaveLength(1);
    expect(recovery.resumedSessionId).toBe(recovery.sessionId);
    expect(interrupted.map((result) => result.tool_use_id)).toEqual([BASH_ID]);
    expect(interrupted[0]?.is_error).toBe(true);
  });
});
