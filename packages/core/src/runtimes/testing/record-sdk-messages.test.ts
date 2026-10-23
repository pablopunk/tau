import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Options, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { type ScriptedTurn, startFakeAnthropicServer } from "./fake-anthropic-server";
import {
  childEnvironment,
  createOfflineWorld,
  FAKE_API_KEY,
  type OfflineWorld,
  sandboxExecAvailable,
  sandboxedSpawns,
} from "./offline-sandbox";

const FIXTURE_FILE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sdk-messages.json");
const FIXTURE_TEXT = "tau-offline-fixture-text-7f3a";
const READ_ID = "toolu_fake_read_0001";
const BASH_ID = "toolu_fake_bash_0001";
const MODEL = "claude-sonnet-4-5";
const PROMPT = "Please read fixture.txt and tell me what it says.";

const recordingEnabled = process.env.TAU_RECORD_SDK_MESSAGES === "1" && sandboxExecAvailable();
const SKIP_REASON = "skipped unless TAU_RECORD_SDK_MESSAGES=1 on macOS with sandbox-exec";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const readTurn = (world: OfflineWorld): ScriptedTurn => ({
  blocks: [{ type: "tool_use", id: READ_ID, name: "Read", input: { file_path: world.fixturePath } }],
});

const deniedBashTurn: ScriptedTurn = {
  blocks: [
    {
      type: "tool_use",
      id: BASH_ID,
      name: "Bash",
      input: { command: "touch denied.txt", description: "touch" },
    },
  ],
};

const textTurn = (text: string): ScriptedTurn => ({ blocks: [{ type: "text", text }] });

async function recordScenario(
  scriptOf: (world: OfflineWorld) => readonly ScriptedTurn[],
  extra: Partial<Options> = {},
): Promise<{ world: OfflineWorld; messages: SDKMessage[] }> {
  const world = createOfflineWorld(FIXTURE_TEXT);
  cleanups.push(() => rmSync(world.root, { recursive: true, force: true }));
  const server = await startFakeAnthropicServer({
    apiKey: FAKE_API_KEY,
    script: scriptOf(world),
    model: MODEL,
  });
  cleanups.push(() => server.close());
  const spawns = sandboxedSpawns(world, server.url);
  cleanups.push(() => spawns.killAllTrees());
  const sdkQuery = query({
    prompt: PROMPT,
    options: {
      model: MODEL,
      cwd: world.cwd,
      systemPrompt: "You are a test agent.",
      title: "record sdk messages",
      tools: ["Read", "Bash"],
      allowedTools: ["Read"],
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
      includePartialMessages: true,
      env: childEnvironment(world, server.url),
      spawnClaudeCodeProcess: spawns.spawn,
      ...extra,
    },
  });
  cleanups.push(() => sdkQuery.close());
  const messages: SDKMessage[] = [];
  try {
    for await (const message of sdkQuery) messages.push(message);
  } catch {
    /* the SDK throws after yielding an error result; the messages are what matters */
  }
  expect(server.violations, spawns.stderr().slice(-2000)).toEqual([]);
  return { world, messages };
}

const scrubbed = (value: unknown, replacements: readonly (readonly [string, string])[]): unknown => {
  let text = JSON.stringify(value);
  for (const [from, to] of replacements) text = text.split(JSON.stringify(from).slice(1, -1)).join(to);
  return JSON.parse(text);
};

describe("SDK message recorder", () => {
  it.skipIf(!recordingEnabled)(
    `records real SDK messages into the committed fixture (${SKIP_REASON})`,
    async () => {
      const read = await recordScenario((world) => [
        readTurn(world),
        textTurn(`The file says: ${FIXTURE_TEXT}. (scripted)`),
      ]);
      const deniedTool = await recordScenario(() => [
        deniedBashTurn,
        textTurn("Bash was denied. (scripted)"),
      ]);
      const errorMaxTurns = await recordScenario((world) => [readTurn(world)], { maxTurns: 1 });

      const scenarios = Object.fromEntries(
        Object.entries({ read, deniedTool, errorMaxTurns }).map(([name, { world, messages }]) => [
          name,
          scrubbed(messages, [
            [world.root, "<TMP>"],
            [homedir(), "<HOME>"],
          ]),
        ]),
      );
      mkdirSync(dirname(FIXTURE_FILE), { recursive: true });
      writeFileSync(FIXTURE_FILE, `${JSON.stringify({ scenarios }, null, 2)}\n`);
      expect(Object.keys(scenarios)).toEqual(["read", "deniedTool", "errorMaxTurns"]);
    },
    120_000,
  );
});
