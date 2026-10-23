import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppError, type ConversationSummary, type ModelRef } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { saveDraft } from "@/conversation/composer/drafts";
import { newAttachment, saveAttachments } from "@/conversation/images/attachments";
import { createApi } from "@/lib/api";
import { preferences } from "@/lib/preferences";
import { createFakeTransport } from "@/lib/transport/fake";
import { installFakeNative } from "@/lib/transport/fake-native";
import { createHttpTransport } from "@/lib/transport/http";
import { NodeApiProvider } from "@/nodes/node-context";
import { NewThreadPage } from "./NewThreadPage";

const pngData =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function ThreadRoute() {
  const location = useLocation();
  return (
    <>
      <h1>Opened {location.pathname}</h1>
      <output aria-label="Navigation state">{JSON.stringify(location.state)}</output>
    </>
  );
}

async function renderPage({
  claude = false,
  model,
  loadFailure,
}: {
  claude?: boolean;
  model?: ModelRef;
  loadFailure?: "projects" | "models" | "settings";
} = {}) {
  const core = createFakeCore({ configured: true });
  await core.providers.setApiKey("openrouter", "fake");
  if (claude) {
    await core.providers.acknowledgeClaudeCli();
    installFakeNative(core);
  }
  const models = await core.models.list();
  const claudeModel = models.find((entry) => entry.provider === "claude-cli");
  if (model) preferences.setLastModel(model);
  const api = createApi(createFakeTransport(core));
  const start = vi.spyOn(api.conversations, "start");
  const runtimes = vi.spyOn(api.runtimes, "list");
  const load = loadFailure
    ? loadFailure === "settings"
      ? vi.spyOn(api.settings, "get")
      : vi.spyOn(api[loadFailure], "list")
    : undefined;
  load?.mockRejectedValueOnce(new AppError("internal", "This node is offline."));
  render(
    <MemoryRouter initialEntries={["/new"]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NodeApiProvider api={api}>
          <TooltipProvider>
            <SidebarProvider>
              <Routes>
                <Route path="/new" element={<NewThreadPage />} />
                <Route path="/p/:projectId/c/:conversationId" element={<ThreadRoute />} />
              </Routes>
            </SidebarProvider>
          </TooltipProvider>
        </NodeApiProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  if (!loadFailure) await screen.findByLabelText("Message");
  return { api, core, start, runtimes, claudeModel, load, user: userEvent.setup() };
}

async function submit(user: ReturnType<typeof userEvent.setup>, text = "hello") {
  await user.type(screen.getByLabelText("Message"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  saveAttachments("new", []);
});
afterEach(() => vi.unstubAllGlobals());

describe("<NewThreadPage> model selection", () => {
  it("has one model picker, no engine choice or runtime discovery dependency", async () => {
    const { runtimes } = await renderPage({ claude: true });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Faux One");
    expect(screen.queryByRole("radiogroup", { name: "Engine" })).not.toBeInTheDocument();
    expect(runtimes).not.toHaveBeenCalled();
  });

  it("ignores the old last-engine preference", async () => {
    window.localStorage.setItem("tau:last-engine", "claude-code");
    await renderPage({ claude: true });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Faux One");
    expect(screen.getByRole("combobox", { name: "Thinking level" })).toBeInTheDocument();
  });

  it("starts and opens a Pi thread with its model and thinking, without an executor key", async () => {
    const { start, user } = await renderPage({ claude: true });
    await submit(user);
    await screen.findByRole("heading", { name: /^Opened \/p\/home\/c\// });
    expect(screen.getByLabelText("Navigation state")).toHaveTextContent(
      JSON.stringify({ tauFirstMessage: { text: "hello", images: [] } }),
    );
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      projectId: "home",
      text: "hello",
      model: { provider: "faux", modelId: "faux-1" },
      thinkingLevel: "medium",
    });
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty("executor");
  });

  it("always shows the model picker and routes a selected Claude model to native", async () => {
    const model = { provider: "claude-cli", modelId: "opus" };
    const { start, user } = await renderPage({ claude: true, model });
    expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Thinking level" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach files" })).not.toBeInTheDocument();
    await submit(user);
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(start.mock.calls[0]?.[0]).toMatchObject({ model, executor: "claude-code", text: "hello" });
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty("thinkingLevel");
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty("images");
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty("files");
    await screen.findByRole("heading", { name: /^Opened \/p\/home\/c\// });
  });

  it("does not invent a Claude model when the CLI is not connected", async () => {
    const { user } = await renderPage();
    await user.click(screen.getByRole("combobox", { name: "Model" }));
    expect(screen.queryByRole("option", { name: /Claude/ })).not.toBeInTheDocument();
  });
});

describe("<NewThreadPage> loading failures", () => {
  it.each(["projects", "models", "settings"] as const)(
    "shows a %s load failure and retries only reads, without submitting",
    async (loadFailure) => {
      saveDraft("new", "Retained draft");
      const { load, start, user } = await renderPage({ loadFailure });
      expect(await screen.findByRole("alert")).toHaveTextContent("This node is offline.");
      expect(screen.queryByRole("status", { name: "Loading" })).not.toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole("button", { name: "Retry loading" }));
      expect(await screen.findByLabelText("Message")).toHaveValue("Retained draft");
      expect(load?.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(start).not.toHaveBeenCalled();
    },
  );
});

describe("<NewThreadPage> start lifecycle", () => {
  it("keeps the draft visible, shows progress and blocks duplicate submits until navigation", async () => {
    const { core, start, user } = await renderPage();
    const created = await core.conversations.start({
      projectId: "home",
      text: "hello",
      requestId: "fixture",
    });
    let resolve!: (value: ConversationSummary) => void;
    start.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await submit(user);
    const message = screen.getByLabelText("Message");
    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(within(conversation).getByText("hello")).toBeInTheDocument();
    expect(within(conversation).getByRole("status")).toHaveTextContent("Sending…");
    expect(screen.getAllByRole("heading", { name: "New thread" })).toHaveLength(2);
    expect(screen.queryByText("Loading conversation")).not.toBeInTheDocument();
    expect(message).toHaveValue("hello");
    expect(message).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Send as steer" })).toBeDisabled();
    expect(screen.getByRole("status", { name: "Starting thread" })).toBeInTheDocument();
    expect(screen.getByText("Starting thread…")).toBeInTheDocument();
    const form = message.closest("form");
    if (!form) throw new Error("Missing composer form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(start).toHaveBeenCalledOnce();
    resolve(created);
    await screen.findByRole("heading", { name: `Opened /p/home/c/${created.id}` });
    expect(screen.getByLabelText("Navigation state")).toHaveTextContent(
      JSON.stringify({ tauFirstMessage: { text: "hello", images: [] } }),
    );
  });

  it("restores a failed start with its image and alert, then reuses its request id on retry", async () => {
    saveAttachments("new", [newAttachment({ mimeType: "image/png", data: pngData })]);
    const { start, user } = await renderPage();
    start.mockRejectedValueOnce(new AppError("internal", "Could not create the worktree"));
    await submit(user);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not create the worktree");
    expect(screen.queryByRole("region", { name: "Conversation" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("hello");
    expect(screen.getByLabelText("Message")).not.toHaveAttribute("readonly");
    expect(screen.getByRole("list", { name: "Attached images" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Attachment 1" })).toHaveAttribute(
      "src",
      `data:image/png;base64,${pngData}`,
    );
    expect(screen.queryByRole("status", { name: "Starting thread" })).not.toBeInTheDocument();
    expect(start.mock.calls[0]?.[0].images).toEqual([{ mimeType: "image/png", data: pngData }]);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("heading", { name: /^Opened \/p\/home\/c\// });
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1]?.[0].requestId).toBe(start.mock.calls[0]?.[0].requestId);
  });

  it("validates an HTTP 201 response and navigates to the returned thread", async () => {
    const { core, start, user } = await renderPage();
    const created = await core.conversations.start({
      projectId: "home",
      text: "hello",
      requestId: "fixture",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(created), { status: 201 })),
    );
    start.mockImplementation(createApi(createHttpTransport()).conversations.start);
    await submit(user);
    await screen.findByRole("heading", { name: `Opened /p/home/c/${created.id}` });
  });

  it("shows an invalid response error and leaves the draft retryable instead of staying busy", async () => {
    const { start, user } = await renderPage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 201 })),
    );
    start.mockImplementation(createApi(createHttpTransport()).conversations.start);
    await submit(user);
    await screen.findByText("The server sent an unexpected response");
    expect(screen.getByLabelText("Message")).toHaveValue("hello");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    expect(screen.queryByRole("status", { name: "Starting thread" })).not.toBeInTheDocument();
  });
});
