import { describeExecutors, type RuntimeCapabilities, type RuntimeDescriptorList } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { claudeCodeDisabledReason, enabledClaudeCode } from "./runtimes";

const CAPABILITIES = describeExecutors(undefined).executors[0]?.capabilities as RuntimeCapabilities;

describe("enabledClaudeCode", () => {
  it("is undefined while the node has not answered", () => {
    expect(enabledClaudeCode(undefined)).toBeUndefined();
  });

  it("is undefined when the node lists Claude Code as disabled", () => {
    expect(enabledClaudeCode(describeExecutors(undefined))).toBeUndefined();
  });

  it("returns the entry when the node enables it", () => {
    const entry = enabledClaudeCode(describeExecutors(CAPABILITIES));
    expect(entry).toMatchObject({ executor: "claude-code", enabled: true });
  });

  it("is undefined for an answer an old node could give", () => {
    expect(enabledClaudeCode([] as unknown as RuntimeDescriptorList)).toBeUndefined();
    expect(enabledClaudeCode({} as RuntimeDescriptorList)).toBeUndefined();
  });
});

describe("claudeCodeDisabledReason", () => {
  it("is undefined until the node answers, when it enables Claude Code, and for an answer an old node could give", () => {
    expect(claudeCodeDisabledReason(undefined)).toBeUndefined();
    expect(claudeCodeDisabledReason(describeExecutors(CAPABILITIES))).toBeUndefined();
    expect(claudeCodeDisabledReason([] as unknown as RuntimeDescriptorList)).toBeUndefined();
  });

  it("is the node's reason as a sentence when Claude Code is disabled", () => {
    const list: RuntimeDescriptorList = {
      executors: describeExecutors(undefined).executors.map((item) =>
        item.executor === "claude-code" ? { ...item, reason: "disabled on this node; read-only" } : item,
      ),
    };

    expect(claudeCodeDisabledReason(list)).toBe("Disabled on this node; read-only.");
  });

  it("falls back to a generic sentence when the disabled entry has no reason", () => {
    const list: RuntimeDescriptorList = {
      executors: describeExecutors(undefined).executors.map(({ reason: _reason, ...item }) => item),
    };

    expect(claudeCodeDisabledReason(list)).toBe("Claude Code is not installed on this node.");
  });
});
