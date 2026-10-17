import type { ConversationSummary } from "@pi-everywhere/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { loadDraft } from "../composer/drafts";
import { MessageMenu } from "../messages/MessageMenu";
import type { MessageEntry } from "../messages/message-actions";
import { TurnChanges } from "./TurnChanges";

vi.mock("@/lib/api", () => ({
  api: {
    conversations: {
      fork: vi.fn(),
      rewind: vi.fn(),
      rewindPreview: vi.fn(),
      checkpoints: vi.fn(),
      checkpointDiff: vi.fn(),
    },
  },
}));

const conversations = vi.mocked(api.conversations);

const thread = { id: "9", projectId: "p1" } as ConversationSummary;
const userEntry: MessageEntry = { conversationId: "4", entryId: "12", role: "user", text: "do it" };
const assistantEntry: MessageEntry = { ...userEntry, entryId: "13", role: "assistant" };

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderWithApp(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {ui}
        <Location />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function pickAction(label: string) {
  await userEvent.click(screen.getByRole("button", { name: "Message actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: label }));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("message actions", () => {
  it("offers Fork on assistant messages only, and opens the new thread", async () => {
    conversations.fork.mockResolvedValue(thread);
    renderWithApp(<MessageMenu entry={assistantEntry} />);
    await userEvent.click(screen.getByRole("button", { name: "Message actions" }));
    expect(screen.queryByRole("menuitem", { name: "Rewind to here" })).toBeNull();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Fork from here" }));
    expect(conversations.fork).toHaveBeenCalledWith("4", "13");
    expect(await screen.findByTestId("location")).toHaveTextContent("/p/p1/c/9");
  });

  it("lists what a rewind changes and warns about ignored files before asking", async () => {
    conversations.rewindPreview.mockResolvedValue({
      checkpointId: "r:before",
      changes: [
        { path: "src/a.ts", action: "write" },
        { path: "new.txt", action: "delete" },
      ],
    });
    renderWithApp(<MessageMenu entry={userEntry} />);
    await pickAction("Rewind to here");
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("new.txt")).toBeInTheDocument();
    expect(screen.getByText(/Ignored files .* are not undone/)).toBeInTheDocument();
    expect(conversations.rewind).not.toHaveBeenCalled();
  });

  it("rewinds on confirm, opens the new thread and leaves the message as its draft", async () => {
    conversations.rewindPreview.mockResolvedValue({ checkpointId: "r:before", changes: [] });
    conversations.rewind.mockResolvedValue({ conversation: thread, draft: "do it" });
    renderWithApp(<MessageMenu entry={userEntry} />);
    await pickAction("Rewind to here");
    await userEvent.click(await screen.findByRole("button", { name: "Rewind" }));
    expect(conversations.rewind).toHaveBeenCalledWith("4", "12");
    expect(await screen.findByTestId("location")).toHaveTextContent("/p/p1/c/9");
    expect(loadDraft("9")).toBe("do it");
  });

  it("shows why a rewind failed and stays open", async () => {
    conversations.rewindPreview.mockResolvedValue({ checkpointId: "r:before", changes: [] });
    conversations.rewind.mockRejectedValue(new Error("A thread in this folder is running."));
    renderWithApp(<MessageMenu entry={userEntry} />);
    await pickAction("Rewind to here");
    await userEvent.click(await screen.findByRole("button", { name: "Rewind" }));
    expect(await screen.findByText("A thread in this folder is running.")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });
});

describe("<TurnChanges>", () => {
  const after = {
    id: "r1:after",
    requestId: "r1",
    entryId: "12",
    kind: "after" as const,
    at: 1,
    files: [{ path: "src/a.ts", added: 2, removed: 1, status: "M" as const }],
  };

  it("shows the file count and a file's diff once expanded", async () => {
    conversations.checkpoints.mockResolvedValue([after]);
    conversations.checkpointDiff.mockResolvedValue("@@ -1 +1,2 @@\n-old\n+new\n+newer");
    renderWithApp(<TurnChanges conversationId="4" entryId="12" />);
    await userEvent.click(await screen.findByRole("button", { name: /1 file changed/ }));
    await userEvent.click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    expect(await screen.findByLabelText("Diff")).toHaveTextContent("newer");
    expect(conversations.checkpointDiff).toHaveBeenCalledWith("4", "r1:after", "src/a.ts");
  });

  it("renders nothing for a turn that changed no files", async () => {
    conversations.checkpoints.mockResolvedValue([{ ...after, files: [] }]);
    const { container } = renderWithApp(<TurnChanges conversationId="4" entryId="12" />);
    await vi.waitFor(() => expect(conversations.checkpoints).toHaveBeenCalled());
    expect(container.querySelector("[data-state]")).toBeNull();
  });
});
