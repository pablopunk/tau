import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  createStubLiveClient,
  endOf,
  liveDoc,
  renderConversation,
  renderView,
  viewWhere,
} from "./test-utils";

const mocks = vi.hoisted(() => ({ send: vi.fn(), abort: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: { conversations: { send: mocks.send, abort: mocks.abort } } }));

describe("<Conversation> states", () => {
  it("subscribes to the conversation and shows a loading state until the first view", () => {
    const client = createStubLiveClient();
    renderConversation(client, "42");
    expect(client.subscribedIds).toEqual(["42"]);
    expect(screen.getByText("Loading conversation")).toBeInTheDocument();
    act(() => client.push(endOf("text")));
    expect(screen.queryByText("Loading conversation")).not.toBeInTheDocument();
  });

  it("shows an unavailable message and no composer for a retired view", () => {
    renderView(null);
    expect(screen.getByText("This thread was deleted")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
  });

  it("shows retirement arriving after a view, from the recorded retired fixture", () => {
    const client = createStubLiveClient(viewWhere("retired", () => true));
    renderConversation(client);
    act(() => client.push(null));
    expect(screen.getByText("This thread was deleted")).toBeInTheDocument();
  });

  it("invites the first message in an empty conversation", () => {
    renderView(viewWhere("text", (view) => view.entries.length === 0));
    expect(screen.getByText("Send a message to start.")).toBeInTheDocument();
  });
});

describe("<Conversation> text and thinking", () => {
  it("renders the user message and the assistant answer and hides system entries", () => {
    renderView(endOf("text"));
    expect(screen.getByText("What is a monad?")).toBeInTheDocument();
    expect(screen.getByText(/This is a scripted reply from the faux model/)).toBeInTheDocument();
    expect(screen.queryByText(/You are a coding agent/)).not.toBeInTheDocument();
  });

  it("shows the streaming answer from the live generation", () => {
    const streaming = viewWhere("text", (view) => JSON.stringify(liveDoc(view)).includes("scripted repl"));
    renderView(streaming);
    expect(screen.getByText(/scripted repl/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("shows a working indicator while busy and nothing has streamed yet", () => {
    renderView(viewWhere("text", (view) => "run" in liveDoc(view) && !("generation" in liveDoc(view))));
    expect(screen.getByText("Working…")).toBeInTheDocument();
  });

  it("collapses thinking and expands it on click", async () => {
    renderView(endOf("thinking"));
    expect(screen.getByText("I thought about it", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/Let me think about this/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Thought/ }));
    expect(screen.getByText(/Let me think about this/)).toBeVisible();
  });

  it("renders markdown, with safe links and tables", () => {
    const view = endOf("text");
    const markdown =
      "# Title\n\n- one\n- two\n\n[docs](https://example.com)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```";
    const entries = view.entries.map((entry) =>
      entry.kind === "pi.assistant"
        ? {
            ...entry,
            model: [{ ...(entry.model?.[0] as object), content: [{ type: "text", text: markdown }] }],
          }
        : entry,
    );
    renderView({ ...view, entries } as typeof view);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
  });
});

describe("<Conversation> tools", () => {
  it("renders a read call with its path and content", async () => {
    renderView(endOf("read"));
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Read"));
    expect(screen.getByRole("figure", { name: "File content" })).toHaveTextContent("hello world");
  });

  it("renders a write call with the written content", async () => {
    renderView(endOf("write"));
    expect(screen.getByText("Write")).toBeInTheDocument();
    expect(screen.getByText("hello.txt")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Write"));
    expect(screen.getByRole("figure", { name: "Written content" })).toBeInTheDocument();
  });

  it("renders an edit call as a diff with change counts", async () => {
    renderView(endOf("edit"));
    await userEvent.click(screen.getByText("Edit"));
    const diff = screen.getByRole("figure", { name: "Diff" });
    expect(within(diff).getByText(/goodbye world/)).toBeInTheDocument();
    expect(within(diff).getByText(/hello world/)).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("renders a finished bash call with its command and output", async () => {
    renderView(endOf("bash"));
    expect(screen.getByText("echo hi && ls")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByRole("figure", { name: "Command output" })).toHaveTextContent("notes.txt");
    expect(screen.queryByText(/Exit \d/)).not.toBeInTheDocument();
  });

  it("shows live bash output while the command runs, open by default", () => {
    renderView(viewWhere("bash", (view) => JSON.stringify(liveDoc(view)).includes('"output":"hi')));
    expect(screen.getByRole("figure", { name: "Command output" })).toHaveTextContent("hi");
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows the exit code of a failed bash call from the result diagnostics", async () => {
    renderView(endOf("bash-fail"));
    expect(screen.getByText("Exit 3")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByRole("figure", { name: "Command output" })).toHaveTextContent("oops");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows an aborted bash call as stopped", () => {
    renderView(endOf("abort"));
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  it("previews long output and expands it on demand", async () => {
    renderView(endOf("overflow"));
    await userEvent.click(screen.getByText("Bash"));
    expect(screen.getByRole("figure", { name: "Command output" })).toHaveTextContent("line 600");
    expect(screen.getByRole("figure", { name: "Command output" })).not.toHaveTextContent("line 1\n");
    await userEvent.click(screen.getByRole("button", { name: /Show all 600 lines/ }));
    expect(screen.getByRole("figure", { name: "Command output" })).toHaveTextContent("line 1");
  });

  it("falls back to a generic renderer for unknown tools", () => {
    const view = endOf("read");
    const entries = view.entries.map((entry) => {
      const message = entry.model?.[0] as { content?: { type: string; name?: string }[] } | undefined;
      if (entry.kind !== "pi.assistant" || !message?.content) return entry;
      const content = message.content.map((block) =>
        block.type === "toolCall" ? { ...block, name: "weather" } : block,
      );
      return { ...entry, model: [{ ...message, content }] };
    });
    renderView({ ...view, entries } as typeof view);
    expect(screen.getByText("weather")).toBeInTheDocument();
  });
});

describe("<Conversation> errors, retries and the inbox", () => {
  it("shows a model error from an assistant entry", () => {
    renderView(endOf("error"));
    expect(screen.getByRole("alert")).toHaveTextContent("The model returned an error");
  });

  it("shows the retry countdown while the provider backs off, then recovers", () => {
    const retrying = viewWhere("retry", (view) => JSON.stringify(liveDoc(view)).includes('"retry"'));
    const { unmount } = renderView(retrying);
    expect(screen.getByRole("status")).toHaveTextContent(/Retry(ing)?/);
    expect(screen.getAllByText(/overloaded/).length).toBeGreaterThan(0);
    unmount();
    renderView(endOf("retry"));
    expect(screen.getByText("Recovered after a failed attempt.")).toBeInTheDocument();
  });

  it("keeps the last error when retries are exhausted", () => {
    renderView(endOf("retry-exhausted"));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Retrying/)).not.toBeInTheDocument();
  });

  it("lists a queued steer message from the inbox and removes it once consumed", () => {
    const queued = viewWhere("steer", (view) =>
      JSON.stringify(view.docs["pi.inbox"]).includes("steered.txt"),
    );
    const { unmount } = renderView(queued);
    const list = screen.getByRole("list", { name: "Queued messages" });
    expect(within(list).getByText("write steered.txt steered")).toBeInTheDocument();
    expect(within(list).getByText(/Will steer the agent/)).toBeInTheDocument();
    unmount();
    renderView(endOf("steer"));
    expect(screen.queryByRole("list", { name: "Queued messages" })).not.toBeInTheDocument();
    expect(screen.getByText("write steered.txt steered")).toBeInTheDocument();
  });

  it("puts queued messages back in the prompt box on Stop", async () => {
    window.localStorage.clear();
    mocks.abort.mockClear();
    const queued = viewWhere("steer", (view) =>
      JSON.stringify(view.docs["pi.inbox"]).includes("steered.txt"),
    );
    renderView(queued);
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(mocks.abort).toHaveBeenCalledWith("2");
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue("write steered.txt steered"));
  });

  it("applies a mid-stream reset: the view after the reset renders like any other", () => {
    renderView(endOf("overflow"));
    expect(screen.getByText("Done.")).toBeInTheDocument();
  });
});
