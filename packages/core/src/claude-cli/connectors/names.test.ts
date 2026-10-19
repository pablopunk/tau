import { describe, expect, it } from "vitest";
import {
  cliToolNameOf,
  connectorAllowGlobOf,
  connectorServerOf,
  connectorToolPrefixOf,
  isConnectorToolName,
  isObservedToolName,
  observedCallOf,
  parseConnectorToolName,
  serverLabelOf,
} from "./names";

describe("connector names", () => {
  it("maps a CLI tool name to a claude_connector call and back", () => {
    const call = parseConnectorToolName("mcp__claude_ai_Linear__list_teams");
    expect(call).toEqual({ server: "Linear", tool: "list_teams" });
    expect(call && cliToolNameOf(call)).toBe("mcp__claude_ai_Linear__list_teams");
  });

  it("keeps underscores inside server and tool names", () => {
    const call = parseConnectorToolName("mcp__claude_ai_Google_Calendar__list_events");
    expect(call).toEqual({ server: "Google_Calendar", tool: "list_events" });
    expect(call && cliToolNameOf(call)).toBe("mcp__claude_ai_Google_Calendar__list_events");
  });

  it("derives the server argument, prefix and glob from the status name", () => {
    expect(connectorServerOf("claude.ai Google Calendar")).toBe("Google_Calendar");
    expect(connectorToolPrefixOf("claude.ai Linear")).toBe("mcp__claude_ai_Linear__");
    expect(connectorAllowGlobOf("claude.ai Slack")).toBe("mcp__claude_ai_Slack__*");
    expect(serverLabelOf("Google_Calendar")).toBe("Google Calendar");
  });

  it("does not claim the tau server or malformed names", () => {
    expect(isConnectorToolName("mcp__tau__get_word")).toBe(false);
    expect(isConnectorToolName("mcp__claude_ai_Linear")).toBe(false);
    expect(isConnectorToolName("mcp__claude_ai_Linear__")).toBe(false);
    expect(isConnectorToolName("bash")).toBe(false);
    expect(isConnectorToolName("mcp__claude_ai_Linear__list_teams")).toBe(true);
  });

  it("observes ToolSearch as a lookup step but never as a connector tool", () => {
    expect(isConnectorToolName("ToolSearch")).toBe(false);
    expect(isObservedToolName("ToolSearch")).toBe(true);
    expect(isObservedToolName("mcp__claude_ai_Linear__list_teams")).toBe(true);
    expect(isObservedToolName("mcp__tau__get_word")).toBe(false);
    expect(observedCallOf("ToolSearch")).toEqual({ server: "Tool search", tool: "search" });
    expect(observedCallOf("mcp__claude_ai_Linear__list_teams")).toEqual({
      server: "Linear",
      tool: "list_teams",
    });
  });
});
