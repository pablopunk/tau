import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProviderInfo } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api";
import { preferences } from "@/lib/preferences";
import { applyTheme } from "@/lib/theme";
import { createFakeTransport } from "@/lib/transport/fake";
import { NodeApiProvider } from "@/nodes/node-context";
import { AppearanceSettings } from "./AppearanceSettings";
import { ProviderRow } from "./ProviderRow";
import { ProvidersSection } from "./ProvidersSection";

const VALID_CALLBACK = "http://127.0.0.1:1455/auth/callback?code=ok&state=faux";

const mocks = vi.hoisted(() => ({ api: null as unknown }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: new Proxy({}, { get: (_, key) => (mocks.api as Record<string, unknown>)[key as string] }),
  };
});

function installFakeBackend() {
  const core = createFakeCore({ configured: false });
  mocks.api = createApi(createFakeTransport(core));
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NodeApiProvider>{ui}</NodeApiProvider>
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.findByRole("listitem", { name });

afterEach(() => window.localStorage.clear());

describe("AppearanceSettings", () => {
  it("applies .dark when Dark is picked and removes it for Light", async () => {
    const stop = applyTheme();
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(preferences.getTheme()).toBe("dark");

    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement).not.toHaveClass("dark");
    stop();
  });
});

describe("AppearanceSettings caption", () => {
  it("shows the caption only while System is selected", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);
    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(screen.getByText(/follows your device/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.queryByText(/follows your device/)).not.toBeInTheDocument();
  });
});

describe("providers", () => {
  it("adds a key and shows the row as connected", async () => {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);

    const row = within(await rowOf("Anthropic"));
    await user.click(row.getByRole("button", { name: "More actions for Anthropic" }));
    await user.click(await screen.findByRole("menuitem", { name: "Add key for Anthropic" }));
    await user.type(row.getByLabelText("Anthropic API key"), "sk-ant-test");
    await user.click(row.getByRole("button", { name: "Save" }));

    expect(await row.findByRole("img", { name: "Connected" })).toBeInTheDocument();
    expect(row.getByText("API key")).toBeInTheDocument();
    await user.click(row.getByRole("button", { name: "More actions for Anthropic" }));
    expect(await screen.findByRole("menuitem", { name: "Replace key for Anthropic" })).toBeInTheDocument();
  });

  it("links to where to get a key", async () => {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);

    const row = within(await rowOf("OpenRouter"));
    await user.click(row.getByRole("button", { name: "Add key for OpenRouter" }));
    expect(row.getByRole("link", { name: "Get a key" })).toHaveAttribute(
      "href",
      "https://openrouter.ai/keys",
    );
  });

  it("shows the invalid key error inline and keeps the row unconnected", async () => {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);
    const row = within(await rowOf("Google"));
    await user.click(row.getByRole("button", { name: "Add key for Google" }));
    await user.type(row.getByLabelText("Google API key"), "bad");
    mocks.api = {
      ...(mocks.api as object),
      providers: {
        ...(mocks.api as { providers: object }).providers,
        setKey: async () => {
          const { AppError } = await import("@tau/protocol");
          throw new AppError("invalid_key", "The key was rejected");
        },
      },
    };
    await user.click(row.getByRole("button", { name: "Save" }));

    expect(await row.findByRole("alert")).toHaveTextContent("The key was rejected");
    expect(row.getByText("Not connected")).toBeInTheDocument();
  });

  it("disconnects a stored key after confirming", async () => {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);

    const row = within(await rowOf("OpenRouter"));
    await user.click(row.getByRole("button", { name: "Add key for OpenRouter" }));
    await user.type(row.getByLabelText("OpenRouter API key"), "sk-or");
    await user.click(row.getByRole("button", { name: "Save" }));
    await user.click(await row.findByRole("button", { name: "More actions for OpenRouter" }));
    await user.click(await screen.findByRole("menuitem", { name: "Disconnect for OpenRouter" }));
    await user.click(row.getByRole("button", { name: "Confirm disconnect" }));

    expect(await row.findByText("Not connected")).toBeInTheDocument();
  });
});

describe("provider status", () => {
  const base: ProviderInfo = {
    id: "anthropic",
    name: "Anthropic",
    methods: ["api_key"],
    keyUrl: "https://example.test/keys",
    cli: null,
    connection: null,
  };
  const withConnection = (connection: ProviderInfo["connection"]) => ({ ...base, connection });

  it("explains that a stored key overrides the environment and offers no Disconnect", () => {
    wrap(<ProviderRow provider={withConnection({ method: "api_key", source: "env", valid: null })} />);
    expect(screen.getByText("From environment")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Connected" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /More actions/ })).not.toBeInTheDocument();
  });

  it("shows a long status in full in a tooltip and keeps a provider with no actions valid", async () => {
    const user = userEvent.setup();
    const cli: ProviderInfo = { ...base, id: "opencode", name: "Claude CLI", methods: [] };
    wrap(<ProviderRow provider={cli} />);
    const row = within(screen.getByRole("listitem", { name: "Claude CLI" }));
    expect(row.queryByRole("button")).not.toBeInTheDocument();
    await user.hover(row.getByText("Not connected"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Not connected");
  });

  it("labels unchecked and invalid stored keys", () => {
    wrap(<ProviderRow provider={withConnection({ method: "api_key", source: "file", valid: null })} />);
    expect(screen.getByText("Key not checked")).toBeInTheDocument();
    wrap(<ProviderRow provider={withConnection({ method: "api_key", source: "file", valid: false })} />);
    expect(screen.getByText("Invalid key")).toBeInTheDocument();
  });
});

describe("provider list structure", () => {
  it("gives every row the same parts and puts extra actions in the overflow menu", async () => {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);
    const rows = await screen.findAllByRole("listitem");
    for (const row of rows) {
      const parts = row.querySelectorAll(
        ":scope > [data-slot=provider-list-name], :scope > [data-slot=provider-list-status], :scope > [data-slot=provider-list-actions]",
      );
      expect(parts).toHaveLength(3);
    }
    const openai = within(await rowOf("OpenAI"));
    expect(openai.getByRole("button", { name: "Sign in with ChatGPT for OpenAI" })).toBeInTheDocument();
    expect(openai.queryByRole("button", { name: "Add key for OpenAI" })).not.toBeInTheDocument();
    await user.click(openai.getByRole("button", { name: "More actions for OpenAI" }));
    expect(await screen.findByRole("menuitem", { name: "Add key for OpenAI" })).toBeInTheDocument();
  });

  it("opens the overflow menu with the keyboard", async () => {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);
    const row = within(await rowOf("OpenAI"));
    row.getByRole("button", { name: "More actions for OpenAI" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("merged Anthropic row", () => {
  it("shows one Anthropic row, no separate Claude CLI row, and keeps the CLI actions", async () => {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);
    const row = within(await rowOf("Anthropic"));
    expect(screen.queryByRole("listitem", { name: "Claude CLI" })).not.toBeInTheDocument();
    expect(row.getByRole("button", { name: "I understand for Anthropic" })).toBeInTheDocument();
    await user.click(row.getByRole("button", { name: "More actions for Anthropic" }));
    expect(await screen.findAllByRole("menuitem")).not.toHaveLength(0);
  });
});

describe("ChatGPT sign-in", () => {
  async function openDialog() {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);
    const row = within(await rowOf("OpenAI"));
    await user.click(row.getByRole("button", { name: "Sign in with ChatGPT for OpenAI" }));
    const dialog = within(await screen.findByRole("dialog"));
    return { user, row, dialog };
  }

  it("opens the sign-in page, accepts the pasted callback and connects", async () => {
    const { user, row, dialog } = await openDialog();

    const link = await dialog.findByRole("link", { name: "Open sign-in page" });
    expect(link).toHaveAttribute("href", "https://auth.fake.test/authorize?state=faux");
    expect(link).toHaveAttribute("target", "_blank");
    await user.type(dialog.getByLabelText("Sign-in address"), VALID_CALLBACK);
    await user.click(dialog.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await row.findByText("ChatGPT plan")).toBeInTheDocument();
    expect(row.getByRole("img", { name: "Connected" })).toBeInTheDocument();
  });

  it("rejects an address that is not the callback without calling the server", async () => {
    const { user, dialog } = await openDialog();

    await user.type(await dialog.findByLabelText("Sign-in address"), "https://example.com/nope");
    await user.click(dialog.getByRole("button", { name: "Submit" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("http://127.0.0.1:1455/auth/callback");
  });
});
