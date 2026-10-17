import type { ToolCall } from "@pi-everywhere/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ToolCallState } from "../model/tool-state";
import type { ToolResultInfo } from "../model/transcript";
import { McpTool } from "./McpTool";
import { WebTool } from "./WebTool";
import { parseWebResults, sizeLabel } from "./web-results";

const SEARCH_TEXT =
  "Answer.\n\n---\n\n**Sources:**\n1. Timers | Vitest\n   https://vitest.dev/guide/mocking/timers\n\n2. fakeTimers\n   https://vitest.dev/config/faketimers\n---\nFull results stored.";

function stateOf(name: string, args: Record<string, unknown>, text: string): ToolCallState {
  const call = { id: "c1", name, arguments: args } as unknown as ToolCall;
  const message = { role: "toolResult", isError: false, content: [{ type: "text", text }] };
  return {
    call,
    status: "done",
    result: { message, diagnostics: [] } as unknown as ToolResultInfo,
    slot: undefined,
  };
}

describe("web tool cards", () => {
  it("parses sources from a web_search answer", () => {
    expect(parseWebResults(SEARCH_TEXT)).toEqual([
      { title: "Timers | Vitest", url: "https://vitest.dev/guide/mocking/timers" },
      { title: "fakeTimers", url: "https://vitest.dev/config/faketimers" },
    ]);
    expect(sizeLabel(512)).toBe("512 chars");
    expect(sizeLabel(12_345)).toBe("12k chars");
  });

  it("lists web_search results with titles and links", async () => {
    render(<WebTool state={stateOf("web_search", { query: "vitest timers" }, SEARCH_TEXT)} />);
    expect(screen.getByText("vitest timers")).toBeTruthy();
    expect(screen.getByText("2 results")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Web search/ }));
    expect(screen.getByRole("link", { name: "Timers | Vitest" }).getAttribute("href")).toBe(
      "https://vitest.dev/guide/mocking/timers",
    );
  });

  it("shows the url and size for fetch_content", () => {
    render(<WebTool state={stateOf("fetch_content", { url: "https://example.com/a" }, "x".repeat(2500))} />);
    expect(screen.getByText("https://example.com/a")).toBeTruthy();
    expect(screen.getByText("2.5k chars")).toBeTruthy();
  });

  it("falls back to the generic card for other web tools", () => {
    render(<WebTool state={stateOf("get_search_content", { responseId: "r" }, "body")} />);
    expect(screen.getByText("get_search_content")).toBeTruthy();
  });
});

describe("mcp tool card", () => {
  it("shows server/tool as the subtitle", () => {
    render(
      <McpTool state={stateOf("mcp_call", { server: "files", tool: "read", arguments: { a: 1 } }, "ok")} />,
    );
    expect(screen.getByText("files/read")).toBeTruthy();
  });
});
