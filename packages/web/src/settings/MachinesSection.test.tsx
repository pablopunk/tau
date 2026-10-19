import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Machine } from "@tau/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { forgetMachineApis, MachineApiProvider } from "@/machines";
import { MachinesSection } from "./MachinesSection";

const machines: Machine[] = [
  {
    id: "m1",
    name: "Homelab",
    os: "linux",
    tauVersion: "0.1.0",
    protocolVersion: "oldprotocolhash",
    status: "update-required",
    lastSeenAt: Date.now(),
    threadCount: 3,
  },
  {
    id: "m2",
    name: "Work laptop",
    os: "darwin",
    tauVersion: "0.2.0",
    protocolVersion: "same",
    status: "offline",
    lastSeenAt: Date.now() - 3 * 3_600_000,
    threadCount: 1,
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const calls: Array<{ method: string; url: string }> = [];
let hubLink: Record<string, unknown> = {
  state: "none",
  hubName: null,
  hubUrl: null,
  since: null,
  message: null,
};

beforeEach(() => {
  calls.length = 0;
  forgetMachineApis();
  hubLink = { state: "none", hubName: null, hubUrl: null, since: null, message: null };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url });
      if (url === "/api/machines") return json(machines);
      if (url === "/api/machines/hub") return json(hubLink);
      if (url.startsWith("/api/pair")) {
        return json({
          kind: "machine",
          code: "code",
          shortCode: "ABCD2345",
          link: "https://hub.example/pair#ABCD2345",
          expiresAt: Date.now() + 300_000,
        });
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return json([]);
    }),
  );
});

const renderSection = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MachineApiProvider>
        <TooltipProvider>
          <MachinesSection />
        </TooltipProvider>
      </MachineApiProvider>
    </QueryClientProvider>,
  );

describe("Settings → Machines", () => {
  it("lists This machine first, then each machine with its state", async () => {
    renderSection();
    const rows = await screen.findAllByRole("listitem");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(within(rows[0] as HTMLElement).getByText("This machine")).toBeInTheDocument();
    const work = screen.getByText("Work laptop").closest("li") as HTMLElement;
    expect(
      within(work).getByText(/macOS · tau 0.2.0 · 1 thread · Offline, last seen 3 h ago/),
    ).toBeInTheDocument();
    expect(within(work).getByRole("button", { name: /Open settings of Work laptop/ })).toBeDisabled();
  });

  it("shows the update command for a machine that needs an update", async () => {
    renderSection();
    const home = (await screen.findByText("Homelab")).closest("li") as HTMLElement;
    expect(within(home).getByText(/Update tau on Homelab/, { selector: "p" })).toBeInTheDocument();
    expect(within(home).getByText("npm i -g @pablopunk/tau@latest")).toBeInTheDocument();
    expect(within(home).getByRole("button", { name: "Copy update command" })).toBeInTheDocument();
  });

  it("disconnects only after a confirmation", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Disconnect Homelab" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "DELETE", url: "/api/machines/m1" }));
  });

  it("the connect dialog shows both commands and says the hub gets full power", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Connect a machine" }));
    expect(
      await screen.findByText("npx @pablopunk/tau connect https://hub.example/pair#ABCD2345"),
    ).toBeInTheDocument();
    expect(screen.getByText("tau connect ABCD2345 --hub https://hub.example")).toBeInTheDocument();
    expect(calls).toContainEqual({ method: "POST", url: "/api/pair?kind=machine" });
    expect(screen.getAllByText(/full power on the machine you connect/).length).toBeGreaterThan(0);
  });

  it("on a machine linked to a hub: no Connect a machine, no Hub badge, the hub is named", async () => {
    hubLink = { state: "linked", hubName: "Home hub", hubUrl: "https://h.example", since: 1, message: null };
    renderSection();
    expect(await screen.findByText(/linked to Home hub/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect a machine" })).toBeNull();
    expect(screen.queryByText("Hub")).toBeNull();
  });

  it("keeps the three searchable setting rows", async () => {
    const { container } = renderSection();
    await screen.findByText("Homelab");
    const ids = [...container.querySelectorAll("[data-setting-id]")].map((el) =>
      el.getAttribute("data-setting-id"),
    );
    expect(ids).toEqual(["machines", "connect-machine", "hub-link"]);
  });
});
