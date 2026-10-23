import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { McpTool } from "./McpTool";
import type { ToolRendererProps } from "./types";

function stateOf(args: Record<string, unknown>): ToolRendererProps["state"] {
  return {
    call: { id: "c1", name: "mcp_call", arguments: args },
    status: "running",
    result: undefined,
    slot: undefined,
  } as unknown as ToolRendererProps["state"];
}

describe("<McpTool>", () => {
  it("shows server/tool when both args are present", () => {
    render(<McpTool state={stateOf({ server: "s", tool: "t" })} />);
    expect(screen.getByText("s/t")).toBeInTheDocument();
  });

  it("shows no ?/? placeholder when args are missing", () => {
    render(<McpTool state={stateOf({})} />);
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.queryByText("?/?")).not.toBeInTheDocument();
  });
});
