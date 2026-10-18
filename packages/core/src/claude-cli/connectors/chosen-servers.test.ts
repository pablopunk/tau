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
  it("chooses nothing when nothing is on", () => {
    expect(chooseServers({ enabled: [], alwaysAllow: [] }, STATUS)).toEqual({ names: [], allowedTools: [] });
  });

  it("allows tau, exact read-only names and always-allowed tools of chosen servers only", () => {
    const chosen = chooseServers(
      {
        enabled: ["claude.ai Linear"],
        alwaysAllow: ["mcp__claude_ai_Linear__save_comment", "mcp__claude_ai_Slack__slack_send_message"],
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

  it("skips enabled servers that are not connected or not listed", () => {
    const chosen = chooseServers(
      { enabled: ["claude.ai Notion", "claude.ai Gone"], alwaysAllow: [] },
      STATUS,
    );
    expect(chosen).toEqual({ names: [], allowedTools: [] });
  });
});
