import { describe, expect, it } from "vitest";
import { agentToolFile, buildAgentToolFile } from "./agent";
import {
  assertNativeCallAllowed,
  EXECUTOR_NOT_AVAILABLE,
  hasExecutor,
  NATIVE_BACKGROUND_REFUSED,
  NATIVE_OPTION_REFUSED,
} from "./agent-native";
import { createToolServicesRef, type ToolFileFactory } from "./tool-file";

type Registered = { name: string; description: string; parameters: { properties: Record<string, unknown> } };

const agentToolOf = (factory: ToolFileFactory): Registered => {
  const file = factory(createToolServicesRef());
  const tools = (file.extension as unknown as { tools: Registered[] }).tools;
  const found = tools.find((tool) => tool.name === "agent");
  if (!found) throw new Error("no agent tool");
  return found;
};

const contractOf = ({ name, description, parameters }: Registered) =>
  `${JSON.stringify({ name, description, parameters }, null, 2)}\n`;

const GATE = { delegation: () => undefined };

describe("agent tool contract", () => {
  it("is byte-identical to the pre-delegation baseline when delegation is off", async () => {
    await expect(contractOf(agentToolOf(agentToolFile))).toMatchFileSnapshot(
      "./__snapshots__/agent-tool-contract.txt",
    );
  });

  it("shows the model no executor parameter or mention of it when delegation is off", () => {
    const tool = agentToolOf(agentToolFile);

    expect(Object.keys(tool.parameters.properties)).not.toContain("executor");
    expect(tool.description).not.toContain("executor");
    expect(tool.description).not.toContain("claude-code");
  });

  it("adds exactly the optional executor parameter and its description when delegation is on", () => {
    const off = agentToolOf(agentToolFile);
    const on = agentToolOf(buildAgentToolFile(GATE));

    expect(Object.keys(on.parameters.properties)).toEqual([
      ...Object.keys(off.parameters.properties),
      "executor",
    ]);
    expect(on.description.startsWith(off.description)).toBe(true);
    expect(on.description).toContain('`executor: "claude-code"`');
    expect(contractOf(on)).not.toBe(contractOf(off));
  });
});

describe("native call validation", () => {
  const base = { description: "d", prompt: "p", executor: "claude-code" } as const;

  it("detects an executor argument whatever its value", () => {
    expect(hasExecutor({ description: "d", prompt: "p" })).toBe(false);
    expect(hasExecutor({ ...base, executor: "other" })).toBe(true);
  });

  it("accepts a plain foreground native call", () => {
    expect(() => assertNativeCallAllowed(base)).not.toThrow();
    expect(() => assertNativeCallAllowed({ ...base, run_in_background: false })).not.toThrow();
  });

  it("refuses background native children", () => {
    expect(() => assertNativeCallAllowed({ ...base, run_in_background: true })).toThrow(
      NATIVE_BACKGROUND_REFUSED,
    );
  });

  it("refuses an unknown executor", () => {
    expect(() => assertNativeCallAllowed({ ...base, executor: "other" })).toThrow(EXECUTOR_NOT_AVAILABLE);
  });

  it("refuses options that only exist for Pi children, naming them", () => {
    expect(() => assertNativeCallAllowed({ ...base, model: "fast", isolation: "worktree" })).toThrow(
      NATIVE_OPTION_REFUSED(["model", "isolation"]),
    );
    expect(() => assertNativeCallAllowed({ ...base, subagent_type: "fork" })).toThrow(
      NATIVE_OPTION_REFUSED(["subagent_type"]),
    );
  });
});
