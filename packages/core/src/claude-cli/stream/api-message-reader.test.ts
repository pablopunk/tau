import type { Api, AssistantMessage, AssistantMessageEvent, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { ClaudeSdkMessage } from "../sdk-types";
import { type ApiMessage, apiMessageEvents, createMessageIds } from "../testing/fake-claude-events";
import { createApiMessageReader, type ReaderSummary } from "./api-message-reader";
import { emptyAssistantMessage } from "./finish";

const MODEL = { id: "m", api: "anthropic-messages", provider: "claude-cli" } as Model<Api>;

const toolRound: ApiMessage = {
  id: "msg_1",
  model: "m",
  stopReason: "tool_use",
  blocks: [
    { type: "thinking", thinking: "hm" },
    { type: "tool_use", id: "toolu_1", name: "mcp__tau__edit", input: { path: "a" } },
  ],
};

function read(feed: readonly ClaudeSdkMessage[]) {
  const message: AssistantMessage = emptyAssistantMessage(MODEL, 0);
  const events: AssistantMessageEvent[] = [];
  let summary: ReaderSummary | null = null;
  const reader = createApiMessageReader(
    message,
    (event) => events.push(event),
    (done) => {
      summary = done;
    },
  );
  for (const sdk of feed) reader.feed(sdk);
  return { message, events, summary: () => summary };
}

describe("api message reader", () => {
  it("completes after message_stop and one assistant message per block", () => {
    const { summary } = read(apiMessageEvents("s", toolRound, createMessageIds()));
    expect(summary()?.toolUseIds).toEqual(["toolu_1"]);
  });

  it("a retried request replaces the abandoned attempt and still completes", () => {
    const ids = createMessageIds();
    const abandoned = apiMessageEvents("s", toolRound, ids);
    const cutAt = abandoned.findIndex(
      (sdk) => sdk.type === "stream_event" && (sdk.event as { index?: number }).index === 1,
    );
    const partial = abandoned.slice(0, cutAt + 1);
    const thinkingAssistant = apiMessageEvents("s", toolRound, ids).find((sdk) => sdk.type === "assistant");
    const retry = apiMessageEvents("s", { ...toolRound, id: "msg_2" }, ids);
    const { message, summary } = read([
      ...partial,
      ...(thinkingAssistant ? [thinkingAssistant] : []),
      ...retry,
    ]);
    expect(summary()?.toolUseIds).toEqual(["toolu_1"]);
    expect(message.content.map((block) => block.type)).toEqual(["thinking", "toolCall"]);
    expect(message.responseId).toBe("msg_2");
  });
});
