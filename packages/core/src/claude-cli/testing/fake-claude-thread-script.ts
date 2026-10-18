import type { FakeScript, FakeStep } from "./fake-claude-script";

export const FAKE_CLAUDE_REPLY = "Fake Claude reply.";
export const FAKE_CLAUDE_TOOL_REPLY = "Fake Claude ran the tool.";

const TOOL_COMMAND = /^(bash|read) (.+)/s;

const toolArguments = (tool: string, rest: string): Record<string, unknown> =>
  tool === "bash" ? { command: rest } : { path: rest };

function toolSteps(tool: string, rest: string): readonly FakeStep[] {
  return [
    { kind: "tools", calls: [{ name: tool, arguments: toolArguments(tool, rest) }] },
    { kind: "text", text: FAKE_CLAUDE_TOOL_REPLY },
  ];
}

/** The script behind `TAU_FAKE_CLAUDE_CLI=1`: "bash <command>" and "read <path>" call that Pi tool, anything else gets a reply. */
export const fakeThreadScript: FakeScript = (_turn, firstUserText, hasTools) => {
  const match = hasTools ? TOOL_COMMAND.exec(firstUserText.trim()) : null;
  if (match?.[1] && match[2]) return toolSteps(match[1], match[2]);
  return [{ kind: "text", text: FAKE_CLAUDE_REPLY }];
};
