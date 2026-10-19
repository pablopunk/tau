import { describe, expect, it } from "vitest";
import { toContextSummary } from "./sdk-port";

const tools = [
  { serverName: "claude.ai Linear", isLoaded: false },
  { serverName: "claude.ai Linear", isLoaded: false },
  { serverName: "claude.ai Slack", isLoaded: false },
];

describe("toContextSummary", () => {
  it("counts every MCP tool as in the window when nothing is deferred, whatever isLoaded says", () => {
    const summary = toContextSummary({
      isAutoCompactEnabled: false,
      totalTokens: 646_000,
      categories: [{ name: "MCP tools", tokens: 640_000, kind: "used" }],
      memoryFiles: [],
      mcpTools: tools,
    });
    expect(summary.loadedMcpToolCounts).toEqual({ "claude.ai Linear": 2, "claude.ai Slack": 1 });
    expect(summary).toMatchObject({ totalTokens: 646_000, mcpTokens: 640_000, deferredMcpTokens: 0 });
  });

  it("reads the deferred row: only loaded tools are in the window", () => {
    const summary = toContextSummary({
      isAutoCompactEnabled: false,
      totalTokens: 6_900,
      categories: [
        { name: "MCP tools", tokens: 600, kind: "used" },
        { name: "MCP tools (deferred)", tokens: 640_000, kind: "deferred" },
        { name: "Free space", tokens: 900_000, kind: "free" },
      ],
      memoryFiles: [{ tokens: 3 }],
      mcpTools: [{ serverName: "claude.ai Linear", isLoaded: true }, ...tools],
    });
    expect(summary.loadedMcpToolCounts).toEqual({ "claude.ai Linear": 1 });
    expect(summary).toMatchObject({ memoryFileCount: 1, mcpTokens: 600, deferredMcpTokens: 640_000 });
  });
});
