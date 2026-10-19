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
let updateStatus: Record<string, unknown> = {
  current: "0.2.0",
  latest: null,
  checkedAt: null,
  behind: false,
};
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
  updateStatus = { current: "0.2.0", latest: null, checkedAt: null, behind: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url });
      if (url === "/api/machines") return json(machines);
      if (url === "/api/machines/hub") return json(hubLink);
      if (url === "/api/update") return json(updateStatus);
      if (url === "/api/update/refresh") {
        updateStatus = { ...updateStatus, latest: "0.3.0", checkedAt: Date.now(), behind: true };
        return json(updateStatus);
      }
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
    expect(within(work).getByText(/macOS · 1 thread · Offline, last seen 3 h ago/)).toBeInTheDocument();
    expect(within(work).getByRole("button", { name: /Open settings of Work laptop/ })).toBeDisabled();
  });

  it("shows the update command for a machine that needs an update", async () => {
    renderSection();
    const home = (await screen.findByText("Homelab")).closest("li") as HTMLElement;
    expect(within(home).getByText(/Update tau on Homelab/, { selector: "p" })).toBeInTheDocument();
    expect(within(home).getByText("npm i -g @pablopunk/tau@latest")).toBeInTheDocument();
    expect(within(home).getByRole("button", { name: "Copy update command" })).toBeInTheDocument();
  });

  it("shows versions and chips: behind, up to date, unknown, never crashes on an empty version", async () => {
    machines.push({ ...(machines[1] as Machine), id: "m3", name: "Fresh", tauVersion: "" });
    updateStatus = { current: "0.2.0", latest: "0.2.0", checkedAt: Date.now(), behind: false };
    try {
      renderSection();
      const home = (await screen.findByText("Homelab")).closest("li") as HTMLElement;
      await within(home).findByText("Behind, latest 0.2.0");
      expect(within(home).getByText("0.1.0")).toBeInTheDocument();
      const work = screen.getByText("Work laptop").closest("li") as HTMLElement;
      expect(within(work).getByText("Up to date")).toBeInTheDocument();
      const fresh = screen.getByText("Fresh").closest("li") as HTMLElement;
      expect(within(fresh).getByText("Version unknown")).toBeInTheDocument();
      expect(screen.getByText("1 machine is behind")).toBeInTheDocument();
    } finally {
      machines.pop();
    }
  });

  it("counts the hub when it is behind, and hides the banner at 0", async () => {
    updateStatus = { current: "0.0.1", latest: "0.1.5", checkedAt: Date.now(), behind: true };
    renderSection();
    expect(await screen.findByText("2 machines are behind")).toBeInTheDocument();
    const hub = screen.getByText("This machine").closest("li") as HTMLElement;
    expect(within(hub).getByText("Behind, latest 0.1.5")).toBeInTheDocument();
  });

  it("no banner when latest is unknown or everything is current", async () => {
    renderSection();
    await screen.findByText("Homelab");
    expect(await screen.findByText(/Latest unknown/)).toBeInTheDocument();
    expect(screen.queryByText(/behind/)).toBeNull();
    expect(screen.getAllByText("Version unknown").length).toBeGreaterThan(0);
  });

  it("Check again posts a refresh and shows the new latest", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText(/Latest known: 0.3.0, checked just now/)).toBeInTheDocument();
    expect(calls).toContainEqual({ method: "POST", url: "/api/update/refresh" });
    expect(await screen.findByText("3 machines are behind")).toBeInTheDocument();
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
