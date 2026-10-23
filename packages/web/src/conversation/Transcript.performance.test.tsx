import type { ConversationView } from "@tau/protocol";
import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { describe, expect, it, vi } from "vitest";
import { ComposerTestWrapper } from "./composer/test-wrapper";
import { Markdown } from "./messages/Markdown";
import * as projection from "./model/transcript";
import { Transcript } from "./Transcript";

vi.mock("react-markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-markdown")>();
  return { ...original, default: vi.fn(original.default) };
});

const historyOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    kind: "pi.assistant",
    id: index + 1,
    model: [
      {
        role: "assistant",
        content: [{ type: "text", text: `Answer **${index}** with [link](https://example.com).` }],
      },
    ],
  })) as unknown as ConversationView["entries"];

function viewOf(entries: ConversationView["entries"], text: string): ConversationView {
  return {
    conversation: { id: "performance" },
    entries,
    docs: {
      "pi.live": {
        run: { taskId: 1, inputs: [] },
        generation: { message: { role: "assistant", content: [{ type: "text", text }] } },
      },
    },
  } as unknown as ConversationView;
}

describe("transcript streaming work (seed 15158)", () => {
  it.each([
    { history: 4, chunks: 32, batch: 1 },
    { history: 128, chunks: 8192, batch: 256 },
  ])("does not reparse $history stable history rows over $chunks chunks", ({ history, chunks, batch }) => {
    vi.mocked(ReactMarkdown).mockClear();
    const derive = vi.spyOn(projection, "buildTranscript");
    const entries = historyOf(history);
    const { rerender } = render(<Transcript view={viewOf(entries, "")} />, { wrapper: ComposerTestWrapper });
    const initialParses = vi.mocked(ReactMarkdown).mock.calls.length;
    const start = performance.now();
    let text = "";
    for (let i = 0; i < chunks; i += batch) {
      text += Array.from({ length: batch }, (_, j) => `chunk-${i + j}\n`).join("");
      rerender(<Transcript view={viewOf(entries, text)} />);
    }
    const parses = vi.mocked(ReactMarkdown).mock.calls.length;
    console.log(
      JSON.stringify({
        history,
        chunks,
        batch,
        updates: chunks / batch,
        initialParses,
        parses,
        derivations: derive.mock.calls.length,
        updateMs: performance.now() - start,
      }),
    );
    derive.mockRestore();
    expect(screen.getByText(/chunk-0/)).toHaveTextContent(`chunk-${chunks - 1}`);
    expect(initialParses).toBe(history);
    expect(parses).toBe(history + chunks / batch);
  });

  it("updates changed Markdown text and presentation, without suppressing new content", () => {
    const { container, rerender } = render(<Markdown className="before">Original **answer**</Markdown>);
    expect(screen.getByText("answer", { selector: "strong" })).toBeInTheDocument();
    rerender(<Markdown className="after">Corrected *answer*</Markdown>);
    expect(screen.queryByText("answer", { selector: "strong" })).not.toBeInTheDocument();
    expect(screen.getByText("answer", { selector: "em" })).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("after");
  });

  it("renders corrected/replaced history and rewind immediately", () => {
    const { rerender } = render(<Transcript view={viewOf(historyOf(2), "live")} />, {
      wrapper: ComposerTestWrapper,
    });
    const corrected = historyOf(1);
    rerender(<Transcript view={viewOf(corrected, "corrected live")} />);
    expect(screen.queryByText("1", { selector: "strong" })).not.toBeInTheDocument();
    expect(screen.getByText("corrected live")).toBeInTheDocument();
    rerender(<Transcript view={viewOf([], "")} />);
    expect(screen.queryByTestId("assistant-message")).not.toBeInTheDocument();
  });
});
