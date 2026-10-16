import type { ConversationView } from "@pi-everywhere/protocol";
import { isRetryable } from "@pi-everywhere/protocol";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { endOf, renderView, viewWhere } from "./test-utils";

vi.mock("@/lib/api", () => ({
  api: {
    conversations: { send: vi.fn(), abort: vi.fn(), retry: vi.fn(), listAll: vi.fn() },
    provider: { models: vi.fn() },
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

function withModels(images: boolean) {
  vi.mocked(api.provider.models).mockResolvedValue([model(images)] as never);
}

function failedView(): ConversationView {
  return viewWhere(
    "fail-retry",
    (view) => isRetryable(view) && view.entries.some((e) => JSON.stringify(e.model).includes('"error"')),
  );
}

beforeEach(() => {
  vi.mocked(api.conversations.retry).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.conversations.listAll)
    .mockReset()
    .mockResolvedValue([{ id: "2", title: "Fix the bug", projectId: "home" }] as never);
  vi.mocked(api.provider.models).mockReset().mockRejectedValue(new Error("offline"));
  window.localStorage.clear();
});

describe("thread header", () => {
  it("shows title, model name and thinking level", async () => {
    withModels(true);
    renderView(endOf("text"));
    expect(await screen.findByText("Fix the bug")).toBeInTheDocument();
    expect(await screen.findByText("Faux One")).toBeInTheDocument();
    expect(screen.getByText("Thinking: off")).toBeInTheDocument();
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

describe("deleted view", () => {
  it("links back to the new thread page", () => {
    renderView(null);
    expect(screen.getByText("This thread was deleted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to new thread" })).toHaveAttribute("href", "/");
  });
});
