import type { ConversationView } from "@pi-everywhere/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queries";
import { conversation } from "@/sidebar/test-support";
import type { ToolCallState } from "../model/tool-state";
import { TaskTool } from "../tools/TaskTool";
import { TodoTool } from "../tools/TodoTool";
import { LatestTodoCallProvider } from "./latest-todo-call";
import { TodoPanel } from "./TodoPanel";
import { latestTodoCallId } from "./todo-items";

vi.mock("@/lib/api", () => ({ api: { conversations: { listAll: vi.fn(async () => []) } } }));

const TODOS = [
  { content: "Write tests", status: "in_progress" },
  { content: "Ship it", status: "pending" },
];

const todoEntry = (id: number, todos: unknown) => ({
  id,
  kind: "pi.assistant",
  model: [
    { role: "assistant", content: [{ type: "toolCall", id: "t", name: "todo_write", arguments: { todos } }] },
  ],
});

const viewWith = (todos: unknown): ConversationView =>
  ({
    entries:
      todos === undefined ? [] : [todoEntry(1, [{ content: "old", status: "pending" }]), todoEntry(2, todos)],
  }) as unknown as ConversationView;

function callState(name: string, args: Record<string, unknown>, details?: unknown): ToolCallState {
  return {
    call: { type: "toolCall", id: "t1", name, arguments: args },
    status: "done",
    result: undefined,
    slot: details ? { callId: "t1", status: "done", details } : undefined,
  } as unknown as ToolCallState;
}

function renderWithClient(ui: ReactNode, children = [conversation({ id: "9", projectId: "p7" })]) {
  const client = new QueryClient();
  client.setQueryData(queryKeys.allConversations, children);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("<TodoPanel>", () => {
  it("shows the latest list with a progress count", () => {
    render(<TodoPanel conversationId="1" view={viewWith(TODOS)} />);
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();
  });

  it("is hidden when the list is empty, missing, or all done", () => {
    for (const todos of [[], undefined, [{ content: "x", status: "completed" }]]) {
      const { container, unmount } = render(<TodoPanel conversationId="1" view={viewWith(todos)} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe("<TodoTool>", () => {
  it("renders the checklist from the call arguments", () => {
    render(<TodoTool state={callState("todo_write", { todos: TODOS })} />);
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    expect(screen.getByText("0/2 done")).toBeInTheDocument();
  });
});

describe("<TodoTool> history", () => {
  it("collapses an earlier todo_write to an Updated todos row", () => {
    render(
      <LatestTodoCallProvider value="newer">
        <TodoTool state={callState("todo_write", { todos: TODOS })} />
      </LatestTodoCallProvider>,
    );
    expect(screen.getByText("Updated todos")).toBeInTheDocument();
    expect(screen.queryByText("Ship it")).not.toBeInTheDocument();
  });

  it("finds the newest todo_write call id", () => {
    expect(latestTodoCallId(viewWith(TODOS))).toBe("t");
    expect(latestTodoCallId(viewWith(undefined))).toBeUndefined();
  });
});

describe("<TaskTool>", () => {
  it("shows the description and links to the child thread", () => {
    renderWithClient(
      <TaskTool state={callState("task", { description: "look around" }, { conversationId: "9" })} />,
    );
    expect(screen.getByText("look around")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/p/p7/c/9");
  });

  it("labels a new subagent", () => {
    renderWithClient(<TaskTool state={callState("task", { description: "look around" })} />);
    expect(screen.getByText("New subagent")).toBeInTheDocument();
  });

  it("labels a continued subagent and still links to it", () => {
    renderWithClient(
      <TaskTool state={callState("task", { description: "more", subagent: "9" }, { conversationId: "9" })} />,
    );
    expect(screen.getByText(/^Continued/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/p/p7/c/9");
  });

  it("has no link before the child exists", () => {
    renderWithClient(<TaskTool state={callState("task", { description: "look around" })} />);
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
  });
});
