import type { ClaudeCliState, ClaudeCliStatus } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import {
  claudeCliAction,
  claudeCliActionLabel,
  claudeCliBadge,
  claudeCliNote,
  withoutProductName,
} from "./ClaudeCliText";

const STATES: ClaudeCliState[] = [
  "ready",
  "needs_notice",
  "missing",
  "logged_out",
  "not_plan",
  "blocked",
  "error",
  "sdk_missing",
];
const CLI_ERRORS = [
  "oauth_org_not_allowed: Claude Code is not allowed",
  "authentication_failed in claude code",
];

const status = (state: ClaudeCliState, extra: Partial<ClaudeCliStatus> = {}): ClaudeCliStatus => ({
  state,
  plan: "Team",
  org: "Maze",
  cliVersion: "2.1.302",
  sdkCliVersion: "2.1.302",
  message: null,
  usage: null,
  processCount: 0,
  connectors: null,
  ...extra,
});

describe("claude CLI text", () => {
  it("builds the badge for each state", () => {
    expect(claudeCliBadge(status("ready", { plan: "max" })).label).toBe(
      "Connected via claude CLI · Max · Maze",
    );
    expect(claudeCliBadge(status("ready")).label).toBe("Connected via claude CLI · Team · Maze");
    expect(claudeCliBadge(status("needs_notice")).label).toBe("Detected · Team · Maze");
    expect(claudeCliBadge(status("missing")).label).toBe("claude CLI not found");
    expect(claudeCliBadge(status("blocked"))).toEqual({
      label: "Blocked by your organization",
      destructive: true,
    });
  });

  it("notes usage, version mismatch and rejection", () => {
    const usage = { status: "allowed" as const, fiveHour: 43, resetsAt: null, updatedAt: 0 };
    expect(claudeCliNote(status("ready", { usage }))).toBe("5-hour 43% · CLI 2.1.302");
    expect(claudeCliNote(status("ready", { usage, sdkCliVersion: "2.1.400" }))).toContain("tau uses 2.1.400");
    const rejected = { ...usage, status: "rejected" as const, resetsAt: 1_800_000_000_000 };
    expect(claudeCliNote(status("ready", { usage: rejected }))).toMatch(
      /^Plan limit reached · resets \d\d:\d\d/,
    );
  });

  it("warns softly when more than 6 Claude processes run", () => {
    expect(claudeCliNote(status("ready", { processCount: 6 }))).toBe("CLI 2.1.302");
    expect(claudeCliNote(status("ready", { processCount: 8 }))).toBe(
      "CLI 2.1.302 · 8 Claude processes running",
    );
  });

  it("offers the SDK install when the SDK is missing", () => {
    const cli = status("sdk_missing");
    expect(claudeCliBadge(cli).label).toBe("Claude Agent SDK not installed");
    expect(claudeCliActionLabel(claudeCliAction(cli))).toBe("Install Claude Agent SDK");
  });

  it("never says Claude Code in any state or CLI error", () => {
    const texts = STATES.flatMap((state) =>
      [undefined, ...CLI_ERRORS].flatMap((message) => {
        const cli = status(state, { message: message ?? null });
        return [claudeCliBadge(cli).label, claudeCliNote(cli) ?? ""];
      }),
    );
    for (const text of texts) expect(text).not.toMatch(/claude code/i);
    expect(withoutProductName("Claude Code")).toBe("claude CLI");
  });
});
