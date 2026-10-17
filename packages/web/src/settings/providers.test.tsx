import type { ProviderInfo } from "@pi-everywhere/protocol";
import { createFakeCore } from "@pi-everywhere/testkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api";
import { preferences } from "@/lib/preferences";
import { applyTheme } from "@/lib/theme";
import { createFakeTransport } from "@/lib/transport/fake";
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
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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

describe("providers", () => {
  it("adds a key and shows the row as connected", async () => {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);

    const row = within(await rowOf("Anthropic"));
    await user.click(row.getByRole("button", { name: "Add key" }));
    await user.type(row.getByLabelText("Anthropic API key"), "sk-ant-test");
    await user.click(row.getByRole("button", { name: "Save" }));

    expect(await row.findByText("Connected · key")).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Replace key" })).toBeInTheDocument();
  });

  it("links to where to get a key", async () => {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);

    const row = within(await rowOf("OpenRouter"));
    await user.click(row.getByRole("button", { name: "Add key" }));
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
    await user.click(row.getByRole("button", { name: "Add key" }));
    await user.type(row.getByLabelText("Google API key"), "bad");
    mocks.api = {
      ...(mocks.api as object),
      providers: {
        ...(mocks.api as { providers: object }).providers,
        setKey: async () => {
          const { AppError } = await import("@pi-everywhere/protocol");
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
    await user.click(row.getByRole("button", { name: "Add key" }));
    await user.type(row.getByLabelText("OpenRouter API key"), "sk-or");
    await user.click(row.getByRole("button", { name: "Save" }));
    await user.click(await row.findByRole("button", { name: "Disconnect" }));
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
    connection: null,
  };
  const withConnection = (connection: ProviderInfo["connection"]) => ({ ...base, connection });

  it("explains that a stored key overrides the environment and offers no Disconnect", () => {
    wrap(<ProviderRow provider={withConnection({ method: "api_key", source: "env", valid: null })} />);
    expect(screen.getByText("From environment")).toBeInTheDocument();
    expect(screen.getByText(/stored key overrides the environment/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  it("labels unchecked and invalid stored keys", () => {
    wrap(<ProviderRow provider={withConnection({ method: "api_key", source: "file", valid: null })} />);
    expect(screen.getByText("Key not checked")).toBeInTheDocument();
    wrap(<ProviderRow provider={withConnection({ method: "api_key", source: "file", valid: false })} />);
    expect(screen.getByText("Invalid key")).toBeInTheDocument();
  });
});

describe("ChatGPT sign-in", () => {
  async function openDialog() {
    installFakeBackend();
    const user = userEvent.setup();
    wrap(<ProvidersSection />);
    const row = within(await rowOf("OpenAI"));
    await user.click(row.getByRole("button", { name: "Sign in with ChatGPT" }));
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
    expect(await row.findByText("Connected · ChatGPT")).toBeInTheDocument();
  });

  it("rejects an address that is not the callback without calling the server", async () => {
    const { user, dialog } = await openDialog();

    await user.type(await dialog.findByLabelText("Sign-in address"), "https://example.com/nope");
    await user.click(dialog.getByRole("button", { name: "Submit" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("http://127.0.0.1:1455/auth/callback");
  });
});
