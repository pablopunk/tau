import { createFakeCore } from "@pi-everywhere/testkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { ToolsSection } from "./ToolsSection";

const mocks = vi.hoisted(() => ({ api: null as unknown }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: new Proxy({}, { get: (_, key) => (mocks.api as Record<string, unknown>)[key as string] }),
  };
});

function renderSection() {
  mocks.api = createApi(createFakeTransport(createFakeCore()));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToolsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ToolsSection", () => {
  it("says web search needs no keys", async () => {
    renderSection();
    expect(await screen.findByText(/work out of the box/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Web search" })).toBeTruthy();
  });

  it("adds a command server and lists it, then removes it", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Add server" }));
    await user.type(screen.getByLabelText("Name"), "files");
    await user.type(screen.getByLabelText("Command"), "npx");
    await user.type(screen.getByLabelText("Environment"), "TOKEN=secret");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const row = await screen.findByRole("listitem", { name: "files" });
    expect(within(row).getByText("Not started")).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret");

    await user.click(within(row).getByRole("button", { name: "Remove files" }));
    await user.click(within(row).getByRole("button", { name: "Confirm remove" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "files" })).toBeNull());
  });

  it("shows a readable error for an invalid form", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Add server" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter a name.");
  });
});
