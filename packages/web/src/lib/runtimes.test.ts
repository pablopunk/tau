import { describeExecutors, type RuntimeCapabilities, type RuntimeDescriptorList } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { enabledClaudeCode } from "./runtimes";

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
