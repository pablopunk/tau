import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaudeConnectorTool, connectorLabel, connectorOutput } from "./ClaudeConnectorTool";

describe("claude connector tool", () => {
  it("strips the claude.ai prefix from the label", () => {
    expect(connectorLabel("claude.ai Linear", "save_comment")).toBe("Linear · save_comment");
    expect(connectorLabel("Linear", "list")).toBe("Linear · list");
  });

  it("explains the unavailable error", () => {
    expect(connectorOutput("Tool claude_connector is not available for this model")).toBe(
      "Claude connectors need a Claude CLI model",
    );
    expect(connectorOutput("boom")).toBe("boom");
  });

  it("renders the card title", () => {
    const state = {
      call: { id: "c1", name: "claude_connector", arguments: { server: "Slack", tool: "search" } },
      status: "running",
      result: undefined,
      slot: undefined,
    } as unknown as Parameters<typeof ClaudeConnectorTool>[0]["state"];
    render(<ClaudeConnectorTool state={state} />);
    expect(screen.getByText("Slack · search")).toBeTruthy();
  });
});
