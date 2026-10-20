import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProviderInfo } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { NodeApiProvider } from "@/nodes/node-context";
import { FastCompactionGroup } from "./FastCompactionGroup";
import {
  FAST_COMPACTION_CONNECT_HINT,
  FAST_COMPACTION_OFFLINE_NOTE,
} from "./fast-compaction-text";

const mocks = vi.hoisted(() => ({
  api: null as unknown,
  providers: [] as ProviderInfo[],
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: new Proxy({}, { get: (_, key) => (mocks.api as Record<string, unknown>)[key as string] }),
  };
});

vi.mock("@/lib/queries", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/queries")>();
  return { ...original, useProviders: () => ({ data: mocks.providers }) };
});

const info = (
  id: ProviderInfo["id"],
  name: string,
  connection: ProviderInfo["connection"],
  decisions: ProviderInfo["decisions"],
): ProviderInfo => ({ id, name, methods: ["api_key"], keyUrl: "", connection, cli: null, decisions });

const TYPESAFE_READY = () =>
  info("typesafe", "TypeSafe", { method: "api_key", source: "file", valid: true }, "ready");
const OPENAI_OFF = () => info("openai", "OpenAI", null, undefined);
const TYPESAFE_OFF = () => info("typesafe", "TypeSafe", null, undefined);

async function renderGroup() {
  const core = createFakeCore({ configured: true });
  mocks.api = createApi(createFakeTransport(core));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = () => (
    <QueryClientProvider client={client}>
      <NodeApiProvider>
        <FastCompactionGroup />
      </NodeApiProvider>
    </QueryClientProvider>
  );
  const view = render(element());
  return { core, refresh: () => view.rerender(element()) };
}

describe("<FastCompactionGroup>", () => {
  it("disables the toggle with the connect hint when no backend is ready", async () => {
    mocks.providers = [TYPESAFE_OFF(), OPENAI_OFF()];
    await renderGroup();
    const toggle = await screen.findByRole("switch", { name: "Fast compaction" });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(FAST_COMPACTION_CONNECT_HINT)).toBeTruthy();
    expect(screen.getByText("TypeSafe: Not connected · OpenAI: Not connected")).toBeTruthy();
  });

  it("shows the hint in a tooltip on hover while locked", async () => {
    const user = userEvent.setup();
    mocks.providers = [TYPESAFE_OFF(), OPENAI_OFF()];
    await renderGroup();
    await user.hover(await screen.findByRole("switch", { name: "Fast compaction" }));
    expect(await screen.findByRole("tooltip", { name: FAST_COMPACTION_CONNECT_HINT })).toBeTruthy();
  });

  it("enables the toggle and saves fast mode when a backend is ready", async () => {
    const user = userEvent.setup();
    mocks.providers = [TYPESAFE_READY(), OPENAI_OFF()];
    const { core } = await renderGroup();
    await core.providers.setApiKey("typesafe", "test-key");
    const toggle = await screen.findByRole("switch", { name: "Fast compaction" });
    expect(toggle).not.toBeDisabled();
    expect(screen.getByText("TypeSafe: Ready · OpenAI: Not connected")).toBeTruthy();
    await user.click(toggle);
    await waitFor(async () => expect((await core.settings.get()).compaction).toEqual({ mode: "fast", backend: "auto" }));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("saves the explicit backend from the picker", async () => {
    const user = userEvent.setup();
    mocks.providers = [TYPESAFE_READY(), OPENAI_OFF()];
    const { core } = await renderGroup();
    await core.providers.setApiKey("typesafe", "test-key");
    await user.click(await screen.findByRole("radio", { name: "TypeSafe" }));
    await waitFor(async () =>
      expect((await core.settings.get()).compaction).toEqual({ mode: "summary", backend: "typesafe" }),
    );
  });

  it("dims with a note but stays on when the last backend disconnects", async () => {
    const user = userEvent.setup();
    mocks.providers = [TYPESAFE_READY(), OPENAI_OFF()];
    const { core, refresh } = await renderGroup();
    await core.providers.setApiKey("typesafe", "test-key");
    await user.click(await screen.findByRole("switch", { name: "Fast compaction" }));
    await waitFor(async () => expect((await core.settings.get()).compaction?.mode).toBe("fast"));

    mocks.providers = [TYPESAFE_OFF(), OPENAI_OFF()];
    await core.providers.disconnect("typesafe");
    refresh();
    expect(await screen.findByText(FAST_COMPACTION_OFFLINE_NOTE)).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Fast compaction" });
    expect(toggle).not.toBeDisabled();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((await core.settings.get()).compaction?.mode).toBe("fast");
  });
});
