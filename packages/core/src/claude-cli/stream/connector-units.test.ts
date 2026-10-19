import type { Message, ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { CONNECTOR_TOOL_NAME } from "../connectors/names";
import { scriptOf } from "../testing/fake-claude-script";
import { optionsKeyOf } from "./connector-choice";
import { toolResultsOf } from "./connector-results";
import { connectorHarness, connectorStep, LINEAR } from "./connector-support";
import { connectorStatusErrorText, neutralText } from "./errors";
import { normalize } from "./normalize";
import { renderRebindTranscript } from "./rebind-transcript";
import {
  ask,
  systemMessage,
  textOfMessage,
  toolCallsOf,
  toolResultFor,
  userMessage,
  waitFor,
} from "./test-support";

const connectorCall: ToolCall = {
  type: "toolCall",
  id: "toolu_1",
  name: CONNECTOR_TOOL_NAME,
  arguments: { server: "Google_Calendar", tool: "list_events", arguments: { day: "today" } },
};

const assistantWith = (call: ToolCall): Message =>
  ({
    role: "assistant",
    content: [call],
    api: "claude-cli",
    provider: "claude-cli",
    model: "haiku",
    usage: {},
    stopReason: "toolUse",
    timestamp: 1,
  }) as unknown as Message;

describe("rebind transcript", () => {
  it("renders connector calls and their results as text", () => {
    const entries = normalize([
      userMessage("what is on?"),
      assistantWith(connectorCall),
      toolResultFor(connectorCall, "standup at 10"),
    ]);
    const text = renderRebindTranscript(entries);
    expect(text).toContain('[connector call Google Calendar · list_events (toolu_1)] {"day":"today"}');
    expect(text).toContain("[connector result Google Calendar · list_events (toolu_1)]\nstandup at 10");
    expect(text).not.toContain("claude_connector");
  });
});

describe("neutral connector errors", () => {
  it("never says Claude Code", () => {
    const text = connectorStatusErrorText({
      name: "claude.ai Linear",
      status: "failed",
      error: "Claude Code could not reach the server",
    });
    expect(text).toBe("claude.ai Linear: Claude CLI could not reach the server");
    expect(neutralText(text)).toBe(text);
  });
});

describe("CLI tool results", () => {
  it("keeps text, images and the error flag", () => {
    const results = toolResultsOf({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "a",
            is_error: true,
            content: [
              { type: "text", text: "boom" },
              { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
            ],
          },
          { type: "tool_result", tool_use_id: "b", content: "plain" },
        ],
      },
    });
    expect(results).toEqual([
      {
        toolUseId: "a",
        result: {
          isError: true,
          content: [
            { type: "text", text: "boom" },
            { type: "image", data: "AAA", mimeType: "image/png" },
          ],
        },
      },
      { toolUseId: "b", result: { isError: false, content: [{ type: "text", text: "plain" }] } },
    ]);
  });
});

describe("adapter paths with connectors", () => {
  it("rebinds, not resumes with an empty message, at a checkpoint before a connector result", async () => {
    const harness = connectorHarness({
      script: scriptOf([
        [connectorStep("list_teams", "33"), { kind: "text", text: "teams" }],
        [{ kind: "text", text: "again" }],
      ]),
    });
    const messages = [systemMessage(), userMessage("go")];
    const first = await ask(harness, messages);
    const [call] = toolCallsOf(first.message);
    const result = toolResultFor(call as ToolCall, "33");
    const second = await ask(harness, [...messages, first.message, result]);
    await ask(harness, [...messages, first.message, result, second.message, userMessage("more")]);
    const retried = await ask(harness, [...messages, first.message, result]);
    expect(retried.message.stopReason).not.toBe("error");
    const latest = harness.fake.queries.at(-1);
    expect(latest?.inputs.join("\n")).toContain("[connector call Linear · list_teams");
    expect(latest?.inputs.join("\n")).not.toContain("<tool-result");
  });

  it("reads the connector list with its own probe when the service gives none", async () => {
    const harness = connectorHarness({ script: scriptOf([[{ kind: "text", text: "ok" }]]) });
    const answer = await ask(harness, [systemMessage(), userMessage("go")]);
    expect(textOfMessage(answer.message)).toBe("ok");
    expect(harness.fake.probes).toHaveLength(1);
    expect(harness.fake.queries[0]?.options.allowedTools).toContain("mcp__claude_ai_Linear__list_teams");
    await ask(harness, [systemMessage(), userMessage("go"), answer.message, userMessage("again")]);
    await waitFor(() => harness.fake.queries.length >= 1);
    expect(harness.fake.probes).toHaveLength(1);
  });

  it("settles a connector result that arrives with a settled listener", async () => {
    const harness = connectorHarness({
      script: scriptOf([[connectorStep("list_teams", LINEAR), { kind: "text", text: "ok" }]]),
    });
    const first = await ask(harness, [systemMessage(), userMessage("go")]);
    expect(first.message.stopReason).toBe("toolUse");
    await waitFor(() => harness.observed.settled.size === 1);
  });
});

describe("optionsKeyOf askBeforeWrites", () => {
  it("changes when askBeforeWrites flips", () => {
    const off = { disabled: ["claude.ai Linear"], alwaysAllow: [], askBeforeWrites: false };
    expect(optionsKeyOf({ ...off, askBeforeWrites: true })).not.toBe(optionsKeyOf(off));
  });
});
