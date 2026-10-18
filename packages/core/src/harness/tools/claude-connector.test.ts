import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { describe, expect, it, vi } from "vitest";
import { createObservedResultStore } from "../../claude-cli/connectors/observed-results";
import type { ClaudeToolResult } from "../../claude-cli/sdk-types";
import { claudeConnectorToolFile } from "./claude-connector";
import type { ToolServices } from "./tool-file";

const RESULT: ClaudeToolResult = {
  content: [
    { type: "text", text: "teams" },
    { type: "image", data: "AAAA", mimeType: "image/png" },
  ],
  isError: false,
};

function setup() {
  const observed = createObservedResultStore();
  const interruptConversation = vi.fn(async () => undefined);
  const services = { claudeConnectors: { observed, interruptConversation } } as unknown as ToolServices;
  const file = claudeConnectorToolFile({ current: () => services, set: () => undefined });
  const tool = file.extension.tools?.[0] as unknown as {
    execute(args: unknown, api: unknown, context: Context): Promise<unknown>;
  };
  const api = { callId: "toolu_1", conversationId: 1, snapshot: async () => ({ sessionId: "pi-session" }) };
  return { observed, interruptConversation, run: (context: Context) => tool.execute({}, api, context) };
}

describe("claude_connector execute", () => {
  it("returns the observed result unchanged and forgets the call", async () => {
    const { observed, run } = setup();
    observed.settle("toolu_1", RESULT);
    expect(await run(BACKGROUND_CONTEXT)).toEqual({ output: RESULT.content, isError: false });
    expect(observed.isConnectorCall("toolu_1")).toBe(false);
  });

  it("interrupts the conversation when aborted", async () => {
    const { interruptConversation, run } = setup();
    const controller = new AbortController();
    const running = run(withAbortSignal(controller.signal, BACKGROUND_CONTEXT));
    controller.abort();
    await expect(running).rejects.toThrow("aborted");
    expect(interruptConversation).toHaveBeenCalledWith("pi-session");
  });
});
