import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AssistantMessage as AssistantMessageData } from "@tau/protocol";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AssistantMessage } from "./AssistantMessage";

vi.mock("@/lib/api", () => ({ api: { models: { list: vi.fn() } } }));

const answer = (provider: string, model: string) =>
  ({
    role: "assistant",
    content: [{ type: "text", text: "hello" }],
    provider,
    model,
    stopReason: "stop",
  }) as unknown as AssistantMessageData;

const info = (modelId: string, name: string) => ({
  provider: "openrouter",
  modelId,
  name,
  contextWindow: 1000,
  reasoning: false,
  images: false,
  thinkingLevels: ["off"],
});

function renderAnswers(...messages: AssistantMessageData[]) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {messages.map((message, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static test list
        <AssistantMessage key={i} message={message} resolveTool={() => ({}) as never} />
      ))}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.models.list)
    .mockReset()
    .mockResolvedValue([
      info("deepseek/deepseek-v4.1-flash", "DeepSeek: DeepSeek V4.1 Flash"),
      info("anthropic/claude-x", "Anthropic: Claude X"),
    ] as never);
});

describe("model label", () => {
  it("shows each answer's own model name", async () => {
    renderAnswers(
      answer("openrouter", "deepseek/deepseek-v4.1-flash"),
      answer("openrouter", "anthropic/claude-x"),
    );
    expect(await screen.findByText("DeepSeek: DeepSeek V4.1 Flash")).toBeInTheDocument();
    expect(screen.getByText("Anthropic: Claude X")).toBeInTheDocument();
  });

  it("falls back to the model id when unknown", async () => {
    renderAnswers(answer("openrouter", "mystery/model"));
    expect(await screen.findByText("mystery/model")).toBeInTheDocument();
  });
});
