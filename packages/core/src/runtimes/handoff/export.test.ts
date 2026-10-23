import type { ConversationView } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { EXPORT_BUDGET_CHARS, exportThreadContext, TOOL_CALL_LINE_MAX, TOOL_RESULT_MAX } from "./export";

type Content = string | readonly Record<string, unknown>[];

const user = (id: number, content: Content) => ({
  id,
  kind: "pi.user",
  model: [{ role: "user", content }],
});

const assistant = (id: number, content: readonly Record<string, unknown>[], extra = {}) => ({
  id,
  kind: "pi.assistant",
  model: [{ role: "assistant", content, stopReason: "stop", ...extra }],
});

const toolResult = (id: number, toolCallId: string, text: string, isError = false) => ({
  id,
  kind: "pi.tool-result",
  model: [{ role: "toolResult", toolCallId, toolName: "bash", isError, content: [{ type: "text", text }] }],
});

const text = (value: string) => ({ type: "text", text: value });

const call = (id: string, name: string, args: Record<string, unknown>) => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});

const viewOf = (...entries: readonly Record<string, unknown>[]): ConversationView =>
  ({ entries, docs: {} }) as unknown as ConversationView;

const mixedView = () =>
  viewOf(
    {
      id: 1,
      kind: "pi.compaction",
      head: 2,
      model: [{ role: "user", content: "Earlier we fixed the parser." }],
    },
    user(2, [
      text("Please run the tests"),
      { type: "image", mimeType: "image/png", data: "AAAA" },
      text('Attached file: "uploads/spec.txt"'),
    ]),
    assistant(3, [
      { type: "thinking", thinking: "hmm" },
      text("Running them now."),
      call("c1", "bash", { command: "pnpm test" }),
    ]),
    toolResult(4, "c1", "ok"),
    assistant(5, [text("All green.")]),
    { id: 6, kind: "app.notice", data: { text: "Context  was\nautomatically trimmed" }, model: [] },
    user(7, "Now fail"),
    assistant(8, [], { stopReason: "error", errorMessage: "provider exploded" }),
  );

describe("exportThreadContext", () => {
  it("renders a mixed thread exactly (golden)", () => {
    const { text: exported, losses } = exportThreadContext(mixedView());

    expect(exported).toBe(
      [
        "[Summary of earlier context]\nEarlier we fixed the parser.",
        [
          "User: Please run the tests",
          "[1 image omitted]",
          "[1 attached file omitted]",
          "Assistant: Running them now.",
          '[tool bash({"command":"pnpm test"})]',
          "[tool result] ok",
          "Assistant: All green.",
          "[Notice: Context was automatically trimmed]",
        ].join("\n"),
        ["User: Now fail", "[error: provider exploded]"].join("\n"),
      ].join("\n\n"),
    );
    expect(losses).toEqual({
      imagesOmitted: 1,
      thinkingBlocksOmitted: 1,
      toolResultsTruncated: 0,
      turnsDropped: 0,
      compactionPresent: true,
      attachmentsOmitted: 1,
      partialTurnTrimmed: false,
      exportedChars: exported.length,
    });
  });

  it("is deterministic: the same view gives identical output", () => {
    const first = exportThreadContext(mixedView());
    const second = exportThreadContext(mixedView());

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("omits thinking, counting every block", () => {
    const { text: exported, losses } = exportThreadContext(
      viewOf(
        user(1, "hi"),
        assistant(2, [
          { type: "thinking", thinking: "secret one" },
          { type: "thinking", thinking: "secret two" },
          text("hello"),
        ]),
      ),
    );

    expect(exported).not.toContain("secret");
    expect(losses.thinkingBlocksOmitted).toBe(2);
  });

  it("truncates a long tool result at 500 characters and counts it", () => {
    const long = "x".repeat(TOOL_RESULT_MAX + 250);
    const { text: exported, losses } = exportThreadContext(
      viewOf(
        user(1, "go"),
        assistant(2, [call("c1", "bash", { command: "cat big" })]),
        toolResult(3, "c1", long),
        assistant(4, [call("c2", "bash", { command: "echo" })]),
        toolResult(5, "c2", "y".repeat(TOOL_RESULT_MAX)),
      ),
    );

    expect(exported).toContain(`${"x".repeat(TOOL_RESULT_MAX)} …[truncated, ${long.length} chars in total]`);
    expect(exported).not.toContain("x".repeat(TOOL_RESULT_MAX + 1));
    expect(exported).toContain("y".repeat(TOOL_RESULT_MAX));
    expect(losses.toolResultsTruncated).toBe(1);
  });

  it("marks a tool error and an empty result", () => {
    const { text: exported } = exportThreadContext(
      viewOf(
        user(1, "go"),
        assistant(2, [call("c1", "bash", { command: "false" }), call("c2", "bash", { command: "true" })]),
        toolResult(3, "c1", "boom", true),
        toolResult(4, "c2", ""),
      ),
    );

    expect(exported).toContain("[tool error] boom");
    expect(exported).toContain("[tool result] (empty)");
  });

  it("keeps a tool call on one line of at most 120 characters", () => {
    const { text: exported } = exportThreadContext(
      viewOf(user(1, "go"), assistant(2, [call("c1", "bash", { command: "a\nb".repeat(200) })])),
    );
    const line = exported.split("\n").find((entry) => entry.startsWith("[tool "));

    expect(line).toBeDefined();
    expect(line?.length).toBeLessThanOrEqual(TOOL_CALL_LINE_MAX);
    expect(line?.endsWith("…)]")).toBe(true);
  });

  it("counts images of a user message given as separate blocks and of a tool result", () => {
    const { losses } = exportThreadContext(
      viewOf(
        user(1, [
          { type: "image", mimeType: "image/png", data: "A" },
          { type: "image", mimeType: "image/png", data: "B" },
          text("look"),
        ]),
        assistant(2, [call("c1", "read", { path: "pic.png" })]),
        {
          id: 3,
          kind: "pi.tool-result",
          model: [
            {
              role: "toolResult",
              toolCallId: "c1",
              toolName: "read",
              isError: false,
              content: [{ type: "image", mimeType: "image/png", data: "C" }],
            },
          ],
        },
      ),
    );

    expect(losses.imagesOmitted).toBe(3);
  });

  it("reports no compaction for a thread that never compacted, and nothing for an empty view", () => {
    expect(exportThreadContext(viewOf(user(1, "hi"))).losses.compactionPresent).toBe(false);
    expect(exportThreadContext(viewOf())).toEqual({
      text: "",
      losses: {
        imagesOmitted: 0,
        thinkingBlocksOmitted: 0,
        toolResultsTruncated: 0,
        turnsDropped: 0,
        compactionPresent: false,
        attachmentsOmitted: 0,
        partialTurnTrimmed: false,
        exportedChars: 0,
      },
    });
  });
});

describe("exportThreadContext budget", () => {
  const bigTurns = (count: number, size: number) =>
    Array.from({ length: count }, (_unused, index) => [
      user(index * 2 + 1, `question ${index} ${"q".repeat(size)}`),
      assistant(index * 2 + 2, [text(`answer ${index} ${"a".repeat(size)}`)]),
    ]).flat();

  it("drops whole oldest turns behind a leading note and keeps the newest", () => {
    const { text: exported, losses } = exportThreadContext(viewOf(...bigTurns(10, 9_000)));

    expect(exported.length).toBeLessThanOrEqual(EXPORT_BUDGET_CHARS);
    expect(losses.turnsDropped).toBeGreaterThan(0);
    expect(
      exported.startsWith(`[${losses.turnsDropped} earlier turns omitted to keep this handoff within `),
    ).toBe(true);
    expect(exported).toContain("question 9 ");
    expect(exported).toContain("answer 9 ");
    expect(exported).not.toContain("question 0 ");
    const keptTurns = (exported.match(/User: question/g) ?? []).length;
    expect(keptTurns + losses.turnsDropped).toBe(10);
    expect(exported).toContain(`question ${10 - keptTurns} `);
    expect(exported).not.toContain(`question ${10 - keptTurns - 1} `);
    expect(losses.exportedChars).toBe(exported.length);
    expect(losses.partialTurnTrimmed).toBe(false);
  });

  it("uses the singular for one dropped turn", () => {
    const { text: exported, losses } = exportThreadContext(viewOf(...bigTurns(7, 4_300)));

    expect(losses.turnsDropped).toBe(1);
    expect(exported.startsWith("[1 earlier turn omitted to keep this handoff within 60000 characters]")).toBe(
      true,
    );
  });

  it("keeps everything when the thread fits the budget", () => {
    const { text: exported, losses } = exportThreadContext(viewOf(...bigTurns(3, 100)));

    expect(losses.turnsDropped).toBe(0);
    expect(exported).not.toContain("omitted to keep");
    expect(exported).toContain("question 0 ");
  });

  it("trims the beginning of a newest turn that alone passes the budget", () => {
    const huge = `START ${"h".repeat(EXPORT_BUDGET_CHARS + 5_000)} END`;
    const { text: exported, losses } = exportThreadContext(
      viewOf(user(1, "old question"), assistant(2, [text("old answer")]), user(3, huge)),
    );

    expect(exported.length).toBeLessThanOrEqual(EXPORT_BUDGET_CHARS);
    expect(losses.partialTurnTrimmed).toBe(true);
    expect(losses.turnsDropped).toBe(1);
    expect(exported).toContain("[the beginning of this turn was trimmed to fit the size limit]");
    expect(exported.endsWith(" END")).toBe(true);
    expect(exported).not.toContain("START");
    expect(exported).not.toContain("old question");
  });

  it("trims a single oversized turn without a leading note", () => {
    const { text: exported, losses } = exportThreadContext(
      viewOf(user(1, `${"z".repeat(EXPORT_BUDGET_CHARS + 10)} TAIL`)),
    );

    expect(exported.length).toBeLessThanOrEqual(EXPORT_BUDGET_CHARS);
    expect(losses).toMatchObject({ partialTurnTrimmed: true, turnsDropped: 0 });
    expect(exported.startsWith("[the beginning of this turn")).toBe(true);
    expect(exported.endsWith(" TAIL")).toBe(true);
  });
});
