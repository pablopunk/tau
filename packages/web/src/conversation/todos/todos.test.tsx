import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConversationView } from "@tau/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { NodeApiProvider } from "@/nodes/node-context";
import { conversation } from "@/sidebar/test-support";
import type { ToolCallState } from "../model/tool-state";
import { TaskTool } from "../tools/TaskTool";
import { TodoTool } from "../tools/TodoTool";
import { LatestTodoCallProvider } from "./latest-todo-call";
import { TodoPanel } from "./TodoPanel";
import { latestTodoSource, latestTodos } from "./todo-items";

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
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(queryKeys.allConversations, children);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <NodeApiProvider>{ui}</NodeApiProvider>
      </QueryClientProvider>
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

describe("<TodoPanel> editing", () => {
  const renderPanel = (api: Api, view: ConversationView) =>
    render(
      <MemoryRouter>
        <NodeApiProvider api={api}>
          <TodoPanel conversationId="1" view={view} />
        </NodeApiProvider>
      </MemoryRouter>,
    );

  it("cycles status and saves the edited list with a requestId", async () => {
    const updateTodos = vi.fn(async () => undefined);
    const api = { conversations: { updateTodos } } as unknown as Api;
    renderPanel(api, viewWith(TODOS));
    await userEvent.click(screen.getByRole("button", { name: "Edit todos" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark completed" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateTodos).toHaveBeenCalledOnce();
    const [id, input] = updateTodos.mock.calls[0] as unknown as [
      string,
      { todos: unknown; requestId: unknown },
    ];
    expect(id).toBe("1");
    expect(input.todos).toEqual([
      { content: "Write tests", status: "completed" },
      { content: "Ship it", status: "pending" },
    ]);
    expect(input.requestId).toEqual(expect.any(String));
  });

  it("adds, deletes and drops empty items on save", async () => {
    const updateTodos = vi.fn(async () => undefined);
    const api = { conversations: { updateTodos } } as unknown as Api;
    renderPanel(api, viewWith(TODOS));
    await userEvent.click(screen.getByRole("button", { name: "Edit todos" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete todo 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.type(screen.getByLabelText("Todo 2"), "New item");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const [, input] = updateTodos.mock.calls[0] as unknown as [string, { todos: unknown }];
    expect(input.todos).toEqual([
      { content: "Write tests", status: "in_progress" },
      { content: "New item", status: "pending" },
    ]);
  });

  it("refuses an overlong todo without calling the api", async () => {
    const updateTodos = vi.fn(async () => undefined);
    const api = { conversations: { updateTodos } } as unknown as Api;
    renderPanel(api, viewWith(TODOS));
    await userEvent.click(screen.getByRole("button", { name: "Edit todos" }));
    await userEvent.type(screen.getByLabelText("Todo 1"), "x".repeat(500));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(updateTodos).not.toHaveBeenCalled();
  });
});

describe("<TodoTool>", () => {
  it("renders a one-line summary instead of the full checklist", () => {
    render(<TodoTool state={callState("todo_write", { todos: TODOS })} />);
    expect(screen.getByText("0/2 done \u2192 Write tests")).toBeInTheDocument();
    expect(screen.queryByText("Ship it")).not.toBeInTheDocument();
  });
});

describe("<TodoTool> history", () => {
  it("labels an earlier todo_write as an Updated todos row", () => {
    render(
      <LatestTodoCallProvider value="call:newer">
        <TodoTool state={callState("todo_write", { todos: TODOS })} />
      </LatestTodoCallProvider>,
    );
    expect(screen.getByText("Updated todos")).toBeInTheDocument();
    expect(screen.getByText("0/2 done \u2192 Write tests")).toBeInTheDocument();
  });

  it("marks the agent list superseded after a newer user edit", () => {
    render(
      <LatestTodoCallProvider value="edit:9">
        <TodoTool state={callState("todo_write", { todos: TODOS })} />
      </LatestTodoCallProvider>,
    );
    expect(screen.getByText("Updated todos")).toBeInTheDocument();
  });

  it("namespaces the newest todo event, newest entry wins", () => {
    expect(latestTodoSource(viewWith(TODOS))).toBe("call:t");
    expect(latestTodoSource(viewWith(undefined))).toBeUndefined();
  });

  it("prefers a newer user edit over the agent list", () => {
    const user = [{ content: "user version", status: "completed" }];
    const view = {
      entries: [todoEntry(1, TODOS), { id: 2, kind: "app.todos_updated", data: { todos: user } }],
    } as unknown as ConversationView;
    expect(latestTodoSource(view)).toBe("edit:2");
    expect(latestTodos(view)).toEqual(user);
  });
});

describe("<TaskTool>", () => {
  it("shows the description and links to the child thread", async () => {
    renderWithClient(
      <TaskTool state={callState("task", { description: "look around" }, { conversationId: "9" })} />,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("look around")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Open" })).toHaveAttribute("href", "/p/p7/c/9");
  });

  it("labels a new subagent", () => {
    renderWithClient(<TaskTool state={callState("task", { description: "look around" })} />);
    expect(screen.getByText("New subagent")).toBeInTheDocument();
  });

  it("labels a continued subagent and still links to it", async () => {
    renderWithClient(
      <TaskTool state={callState("task", { description: "more", subagent: "9" }, { conversationId: "9" })} />,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/^Continued/)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Open" })).toHaveAttribute("href", "/p/p7/c/9");
  });

  it("has no link before the child exists", () => {
    renderWithClient(<TaskTool state={callState("task", { description: "look around" })} />);
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
  });
});
