import { describe, expect, it } from "vitest";
import { JUDGE_BUDGET_CHARS, judgeInput, transcriptOf } from "./judge-transcript";
import { parseVerdict } from "./judge-verdict";

describe("judgeInput", () => {
  it("keeps the whole transcript when it fits", () => {
    const text = judgeInput("tests pass", "assistant: done");
    expect(text).toContain("tests pass");
    expect(text).toContain("assistant: done");
  });

  it("keeps the condition in full and the newest part of the transcript within the budget", () => {
    const condition = "c".repeat(4000);
    const transcript = `OLDEST${"x".repeat(100_000)}NEWEST`;
    const text = judgeInput(condition, transcript);
    expect(text.length).toBeLessThanOrEqual(JUDGE_BUDGET_CHARS);
    expect(text).toContain(condition);
    expect(text).toContain("NEWEST");
    expect(text).not.toContain("OLDEST");
  });
});

describe("transcriptOf", () => {
  it("includes tool calls and tool results, the evidence the judge needs", () => {
    const entries = [
      { id: 1, kind: "pi.user", model: [{ role: "user", content: "run the tests" }] },
      {
        id: 2,
        kind: "pi.assistant",
        model: [
          {
            role: "assistant",
            content: [{ type: "toolCall", name: "bash", arguments: { command: "pnpm test" } }],
          },
        ],
      },
      {
        id: 3,
        kind: "pi.toolResult",
        model: [{ role: "toolResult", toolName: "bash", content: [{ type: "text", text: "12 passed" }] }],
      },
    ];
    const text = transcriptOf(entries);
    expect(text).toContain("user: run the tests");
    expect(text).toContain("bash");
    expect(text).toContain("12 passed");
  });
});

describe("parseVerdict", () => {
  it("reads JSON, also inside a code fence", () => {
    expect(parseVerdict('```json\n{"verdict":"met","reason":"ok"}\n```')).toEqual({
      verdict: "met",
      reason: "ok",
    });
  });

  it("rejects an unknown verdict and plain text", () => {
    expect(parseVerdict('{"verdict":"maybe","reason":"x"}')).toBeUndefined();
    expect(parseVerdict("met")).toBeUndefined();
  });
});
