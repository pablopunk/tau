import type { ConversationSummary, ToolCall } from "@tau/protocol";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversation, renderAt } from "@/sidebar/test-support";
import type { ToolCallState } from "../model/tool-state";
import type { ToolResultInfo } from "../model/transcript";
import { AgentListTool } from "./AgentListTool";
import { AgentMergeTool } from "./AgentMergeTool";
import { AgentSendMessageTool } from "./AgentSendMessageTool";
import { AgentTool } from "./AgentTool";

const children: { current: ConversationSummary[] } = { current: [] };
const models: { current: Record<string, unknown>[] } = { current: [] };
const { stopAgent } = vi.hoisted(() => ({ stopAgent: vi.fn(async () => {}) }));

vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useAllConversations: () => ({ data: children.current }),
  useModels: () => ({ data: models.current }),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, conversations: { stopAgent } } };
});

function stateOf(
  name: string,
  args: Record<string, unknown>,
  text: string,
  details: unknown = {},
  isError = false,
): ToolCallState {
  const call = { id: "c1", name, arguments: args } as unknown as ToolCall;
  const message = { role: "toolResult", isError, details, content: [{ type: "text", text }] };
  return {
    call,
    status: isError ? "error" : "done",
    result: { message, diagnostics: [] } as unknown as ToolResultInfo,
    slot: undefined,
  };
}

const child = (overrides: Partial<ConversationSummary> = {}) =>
  conversation({
    id: "kid",
    title: "Explorer",
    parentId: "1",
    agentType: "fork",
    agentModel: { provider: "x", modelId: "model-9" },
    agentStatus: "running",
    ...overrides,
  });

describe("agent tool cards", () => {
  beforeEach(() => {
    children.current = [child()];
    models.current = [];
    stopAgent.mockClear();
  });

  it("shows type, model, live status and stops a running child", async () => {
    const state = stateOf("agent", { description: "look around" }, "", { conversationId: "kid" });
    renderAt("/", <AgentTool state={state} />);
    expect(screen.getByText("fork")).toBeTruthy();
    expect(screen.getByText("model-9")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stopAgent).toHaveBeenCalledWith("kid");
  });

  it("hides Stop once the child is done", () => {
    children.current = [child({ agentStatus: "done" })];
    renderAt("/", <AgentTool state={stateOf("agent", {}, "", { conversationId: "kid" })} />);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("shows one status for a stopped child, taken from the child", () => {
    children.current = [child({ agentStatus: "stopped" })];
    renderAt("/", <AgentTool state={stateOf("agent", {}, "", { conversationId: "kid" })} />);
    expect(screen.getByText("stopped")).toBeTruthy();
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("shows the error text of a failed agent call", () => {
    const state = stateOf("agent", { description: "x" }, "isolation failed badly", {}, true);
    renderAt("/", <AgentTool state={state} />);
    expect(screen.getByText("isolation failed badly")).toBeTruthy();
  });

  it("shows the model's display name instead of its id", async () => {
    models.current = [{ provider: "x", modelId: "model-9", name: "Nine" }];
    renderAt("/", <AgentTool state={stateOf("agent", {}, "", { conversationId: "kid" })} />);
    expect(screen.getByText("Nine")).toBeTruthy();
    expect(screen.queryByText("model-9")).toBeNull();
  });

  it("names the child and mode in a send_message card", () => {
    const state = stateOf("send_message", { to: "kid", message: "hi", mode: "steer" }, "ok");
    renderAt("/", <AgentSendMessageTool state={state} />);
    expect(screen.getByText("Message to Explorer")).toBeTruthy();
    expect(screen.getByText("steer")).toBeTruthy();
  });

  it("tables the children of list_agents", async () => {
    const agents = [{ id: "kid", description: "scan", type: "fork", model: "m", status: "done" }];
    renderAt("/", <AgentListTool state={stateOf("list_agents", {}, "", { agents })} />);
    await userEvent.click(screen.getByRole("button", { name: /Subagents/ }));
    expect(screen.getByText("scan")).toBeTruthy();
  });

  it("flags a merge conflict", () => {
    renderAt(
      "/",
      <AgentMergeTool state={stateOf("merge_agent", { id: "kid" }, "conflict in a.ts", {}, true)} />,
    );
    expect(screen.getByText("conflict in a.ts")).toBeTruthy();
  });
});
