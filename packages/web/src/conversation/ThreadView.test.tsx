import type { ConversationView } from "@tau/protocol";
import { isRetryable } from "@tau/protocol";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfNode } from "@/nodes/node-apis";
import { endOf, renderView, viewWhere } from "./test-utils";

const api = apiOfNode();

vi.mock("@/lib/api", () => ({
  api: {
    conversations: { send: vi.fn(), abort: vi.fn(), retry: vi.fn(), listAll: vi.fn(), configure: vi.fn() },
    models: { list: vi.fn() },
  },
}));

const model = (images: boolean) => ({
  provider: "faux",
  modelId: "faux-1",
  name: "Faux One",
  contextWindow: 1000,
  reasoning: false,
  images,
  thinkingLevels: ["off"],
});

const reasoningModel = {
  ...model(true),
  modelId: "faux-r",
  name: "Faux Reasoner",
  thinkingLevels: ["off", "low", "high"],
};

function withModels(images: boolean) {
  vi.mocked(api.models.list).mockResolvedValue([model(images)] as never);
}

function failedView(): ConversationView {
  return viewWhere(
    "fail-retry",
    (view) => isRetryable(view) && view.entries.some((e) => JSON.stringify(e.model).includes('"error"')),
  );
}

beforeEach(() => {
  vi.mocked(api.conversations.retry).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.conversations.configure).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.conversations.listAll)
    .mockReset()
    .mockResolvedValue([{ id: "2", title: "Fix the bug", projectId: "home" }] as never);
  vi.mocked(api.models.list).mockReset().mockRejectedValue(new Error("offline"));
  window.localStorage.clear();
});

describe("thread header", () => {
  it("shows the title and the model picker", async () => {
    withModels(true);
    renderView(endOf("text"));
    // The title renders in both the mobile bar and the desktop header;
    // CSS shows exactly one per viewport (jsdom shows both).
    expect(await screen.findAllByText("Fix the bug")).toHaveLength(2);
    expect(await screen.findByRole("combobox", { name: "Model" })).toHaveTextContent("Faux One");
  });
});

describe("changing the model and thinking level", () => {
  it("sends the chosen model, then the chosen level of that model", async () => {
    vi.mocked(api.models.list).mockResolvedValue([model(true), reasoningModel] as never);
    renderView(endOf("text"));
    await userEvent.click(await screen.findByRole("combobox", { name: "Model" }));
    await userEvent.click(await screen.findByRole("option", { name: /Faux Reasoner/ }));
    expect(api.conversations.configure).toHaveBeenCalledWith("2", {
      model: { provider: "faux", modelId: "faux-r" },
    });
  });

  it("shows only the levels of the thread's model", async () => {
    const thread = endOf("text");
    const agent = thread.docs["pi.agent"] as unknown as { model: object };
    const onReasoner = {
      ...thread,
      docs: { ...thread.docs, "pi.agent": { ...agent, model: { provider: "faux", modelId: "faux-r" } } },
    } as ConversationView;
    vi.mocked(api.models.list).mockResolvedValue([model(true), reasoningModel] as never);
    renderView(onReasoner);
    await userEvent.click(await screen.findByRole("combobox", { name: "Thinking level" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "off",
      "low",
      "high",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "high" }));
    expect(api.conversations.configure).toHaveBeenCalledWith("2", { thinkingLevel: "high" });
  });

  it("hides the thinking picker for a model without reasoning", async () => {
    withModels(true);
    renderView(endOf("text"));
    await screen.findByRole("combobox", { name: "Model" });
    expect(screen.queryByRole("combobox", { name: "Thinking level" })).toBeNull();
  });
});

describe("images in the thread", () => {
  it("renders an image block as a thumbnail that opens a dialog", async () => {
    renderView(endOf("image"));
    await userEvent.click(screen.getByRole("button", { name: "Open Attachment 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "Attachment 1, full size" })).toBeInTheDocument();
  });

  it("hides the attach button when the thread model has no image support", async () => {
    withModels(false);
    renderView(endOf("text"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Attach images" })).toBeNull());
  });

  it("allows images when the model is unknown", () => {
    renderView(endOf("text"));
    expect(screen.getByRole("button", { name: "Attach images" })).toBeInTheDocument();
  });
});

describe("copy buttons", () => {
  it("copies a user message and an assistant answer", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    renderView(endOf("text"));
    await user.click(screen.getAllByRole("button", { name: "Copy message" })[0] as HTMLElement);
    await user.click(screen.getAllByRole("button", { name: "Copy answer" })[0] as HTMLElement);
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe("retry", () => {
  it("shows Retry after a failed answer and calls retry with a requestId", async () => {
    renderView(failedView());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(api.conversations.retry).toHaveBeenCalledWith("2", { requestId: expect.any(String) });
  });

  it("reuses the requestId when the retry request failed", async () => {
    vi.mocked(api.conversations.retry).mockRejectedValueOnce(new Error("down"));
    renderView(failedView());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("down")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    const [first, second] = vi.mocked(api.conversations.retry).mock.calls;
    expect(first?.[1]).toEqual(second?.[1]);
  });

  it("shows no Retry after a finished answer", () => {
    renderView(endOf("text"));
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows a Retried divider for app.retry entries", () => {
    renderView(endOf("fail-retry"));
    expect(screen.getByText("Retried")).toBeInTheDocument();
  });
});

describe("compaction in the transcript", () => {
  const withCompaction = (reason: string): ConversationView => {
    const view = endOf("text");
    const entry = { id: "cmp", kind: "pi.compaction", head: "x", data: { reason }, model: [] };
    return { ...view, entries: [...view.entries, entry] } as unknown as ConversationView;
  };

  it.each(["manual", "threshold", "overflow"])("shows a divider for a %s compaction", (reason) => {
    renderView(withCompaction(reason));
    expect(screen.getByText("Context compacted")).toBeInTheDocument();
  });

  it("shows a Compacting row while a compaction runs", () => {
    const view = endOf("text");
    const live = { ...(view.docs["pi.live"] as object), compactions: [{ taskId: "t", reason: "manual" }] };
    renderView({ ...view, docs: { ...view.docs, "pi.live": live } } as unknown as ConversationView);
    expect(screen.getByText("Compacting context…")).toBeInTheDocument();
  });

  it("shows no Compacting row otherwise", () => {
    renderView(endOf("text"));
    expect(screen.queryByText("Compacting context…")).not.toBeInTheDocument();
  });
});

describe("deleted view", () => {
  it("links back to the new thread page", () => {
    renderView(null);
    expect(screen.getByText("This thread was deleted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to new thread" })).toHaveAttribute("href", "/");
  });
});
