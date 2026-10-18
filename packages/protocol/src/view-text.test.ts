import { describe, expect, it } from "vitest";
import type { ConversationView } from "./view";
import { lastAssistantText, viewToText } from "./view-text";

const entry = (id: number, kind: string, model?: unknown, data?: unknown) => ({ id, kind, model, data });

const view = {
  entries: [
    entry(1, "pi.system"),
    entry(2, "pi.user", [{ role: "user", content: "Fix the test" }]),
    entry(3, "pi.assistant", [
      {
        role: "assistant",
        content: [
          { type: "text", text: "On it." },
          { type: "toolCall", id: "c1", name: "bash", arguments: { command: "pnpm test" } },
        ],
      },
    ]),
    entry(4, "pi.tool-result", [{ role: "toolResult", toolCallId: "c1", content: [] }]),
    entry(5, "pi.user", [{ role: "user", content: "<subagent-notification>x</subagent-notification>" }]),
    entry(6, "app.subagent_notification", undefined, {
      childId: "c",
      status: "done",
      title: "Lint",
      report: "All clean",
    }),
    entry(7, "pi.assistant", [{ role: "assistant", content: [{ type: "text", text: "Done." }] }]),
  ],
  docs: {},
} as unknown as ConversationView;

describe("viewToText", () => {
  it("renders the transcript", () => {
    expect(viewToText(view)).toMatchInlineSnapshot(`
      "user: Fix the test

      assistant: On it.
        > bash {"command":"pnpm test"}

      notification: subagent "Lint" finished: All clean

      assistant: Done."
    `);
  });

  it("keeps the last messages", () => {
    expect(viewToText(view, { last: 1 })).toBe("assistant: Done.");
  });

  it("finds the last answer", () => {
    expect(lastAssistantText(view)).toBe("Done.");
  });
});
