import { describe, expect, it } from "vitest";
import type { ClaudeMcpServerStatus } from "../sdk-types";
import {
  FAKE_LINEAR,
  FAKE_NEEDS_AUTH,
  FAKE_SLACK,
  type FakeConnectorServer,
} from "../testing/fake-claude-connectors";
import { chooseServers } from "./chosen-servers";

const statusOf = (server: FakeConnectorServer): ClaudeMcpServerStatus => ({
  name: server.name,
  status: server.status,
  source: "claudeai",
  error: null,
  tools: server.tools,
});

const STATUS = [FAKE_LINEAR, FAKE_SLACK, FAKE_NEEDS_AUTH].map(statusOf);

describe("chooseServers", () => {
  it("chooses nothing when everything is switched off", () => {
    const disabled = ["claude.ai Linear", "claude.ai Slack"];
    expect(chooseServers({ disabled, alwaysAllow: [], askBeforeWrites: false }, STATUS)).toEqual({
      names: [],
      allowedTools: [],
    });
  });

  it("chooses every connected server by default, never one that needs sign-in", () => {
    const chosen = chooseServers({ disabled: [], alwaysAllow: [], askBeforeWrites: false }, STATUS);
    expect(chosen.names).toEqual(["claude.ai Linear", "claude.ai Slack"]);
  });

  it("allows tau, exact read-only names and always-allowed tools of chosen servers only", () => {
    const chosen = chooseServers(
      {
        disabled: ["claude.ai Slack"],
        alwaysAllow: ["mcp__claude_ai_Linear__save_comment", "mcp__claude_ai_Slack__slack_send_message"],
        askBeforeWrites: true,
      },
      STATUS,
    );
    expect(chosen.names).toEqual(["claude.ai Linear"]);
    expect(chosen.allowedTools).toEqual([
      "mcp__tau__*",
      "mcp__claude_ai_Linear__list_teams",
      "mcp__claude_ai_Linear__get_issue",
      "mcp__claude_ai_Linear__save_comment",
    ]);
  });

  it("allows the exact name of every tool of chosen servers when writes do not ask", () => {
    const chosen = chooseServers(
      { disabled: ["claude.ai Slack"], alwaysAllow: [], askBeforeWrites: false },
      STATUS,
    );
    expect(chosen.allowedTools).toEqual(
      expect.arrayContaining(["mcp__claude_ai_Linear__save_comment", "mcp__claude_ai_Linear__get_issue"]),
    );
    expect(chosen.allowedTools.some((name) => name.includes("Slack") || name.includes("Linear__*"))).toBe(
      false,
    );
  });

  it("skips servers that are not connected, and ignores unknown disabled names", () => {
    const chosen = chooseServers(
      { disabled: ["claude.ai Gone", "claude.ai Slack"], alwaysAllow: [], askBeforeWrites: false },
      STATUS.filter((server) => server.name !== "claude.ai Linear"),
    );
    expect(chosen).toEqual({ names: [], allowedTools: [] });
  });
});
