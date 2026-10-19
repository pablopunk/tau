import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore, type FakeCore } from "@tau/testkit";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { MachineApiProvider } from "@/machines/machine-context";
import { RemoteSection } from "./RemoteSection";
import { SETTINGS_INDEX } from "./settings-index";

const mocks = vi.hoisted(() => ({ api: null as unknown }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: new Proxy({}, { get: (_, key) => (mocks.api as Record<string, unknown>)[key as string] }),
  };
});

let core: FakeCore;
let client: QueryClient;
const refresh = () => act(async () => void (await client.invalidateQueries()));

function setup(remote: boolean) {
  core = createFakeCore({ remote });
  mocks.api = createApi(createFakeTransport(core));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MachineApiProvider>
        <TooltipProvider>
          <RemoteSection />
        </TooltipProvider>
      </MachineApiProvider>
    </QueryClientProvider>,
  );
}

const redeem = (code: string, name: string) =>
  core.access.redeemPairing({ code: code.replace(" ", ""), deviceName: name, peer: "p" });

async function pair(name: string) {
  const minted = await core.access.mintPairing({ kind: "device" });
  await core.access.redeemPairing({ code: minted.code, deviceName: name, peer: "p" });
}

describe("remote status", () => {
  it("shows off with a disabled link button", async () => {
    setup(false);
    expect(await screen.findByText("Off")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.getAllByRole("button", { name: "Link a device" })[0]).toBeDisabled();
  });

  it("turning on shows the URL and the sleep note", async () => {
    setup(false);
    await userEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByText("Online")).toBeInTheDocument();
    expect(screen.getByText(/fake-1\.tunnel\.test/)).toBeInTheDocument();
    expect(screen.getByText(/only while this Mac is awake/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy URL" })).toBeInTheDocument();
  });

  it("starting says it takes a few minutes", async () => {
    setup(true);
    await screen.findByText("Online");
    core.remoteControl.push({ state: "starting" });
    await refresh();
    expect(await screen.findByText("Setting up")).toBeInTheDocument();
    expect(screen.getByText(/usually 3-6 minutes/)).toBeInTheDocument();
  });

  it("reconnecting offers a new URL only when canRecreate", async () => {
    setup(true);
    await screen.findByText("Online");
    core.remoteControl.push({ state: "reconnecting" });
    await refresh();
    expect(await screen.findByText("Reconnecting")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make a new URL" })).toBeNull();
    core.remoteControl.push({ canRecreate: true });
    await refresh();
    await userEvent.click(await screen.findByRole("button", { name: "Make a new URL" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/device must pair again/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Make a new URL" }));
    expect(await screen.findByText(/fake-2\.tunnel\.test/)).toBeInTheDocument();
  });

  it("shows an error message", async () => {
    setup(true);
    await screen.findByText("Online");
    core.remoteControl.push({ state: "error", message: "Could not reach the relay." });
    await refresh();
    expect(await screen.findByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Could not reach the relay.")).toBeInTheDocument();
  });

  it("asks before turning off, then turns off", async () => {
    setup(true);
    await userEvent.click(await screen.findByRole("switch"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/URL is kept/)).toBeInTheDocument();
    expect(within(dialog).getByText(/linked devices cannot connect/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("switch")).toBeChecked();
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Turn off" }),
    );
    await waitFor(() => expect(screen.getByText("Off")).toBeInTheDocument());
  });
});

describe("link a device", () => {
  beforeEach(() =>
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date", "setInterval", "clearInterval"] }),
  );
  afterEach(() => vi.useRealTimers());

  it("shows code, link, countdown, then the linked device", async () => {
    setup(true);
    await screen.findByText("Online");
    await userEvent.click(screen.getByRole("button", { name: "Link a device" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("img", { name: "QR code of the link" })).toBeInTheDocument();
    expect(within(dialog).getByText(/\/pair#/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Waiting for the device… Expires in 5:0\d/)).toBeInTheDocument();
    expect(within(dialog).getByText(/full power/)).toBeInTheDocument();
    const shortCode = within(dialog).getByText(/^[A-Z2-9]{4} [A-Z2-9]{4}$/).textContent ?? "";
    await act(async () => vi.advanceTimersByTime(61_000));
    expect(within(dialog).getByText(/Expires in 3:\d\d/)).toBeInTheDocument();
    await act(async () => {
      await redeem(shortCode, "Safari on iPhone");
    });
    await refresh();
    expect(await within(dialog).findByText("Linked: Safari on iPhone")).toBeInTheDocument();
  });

  it("expires and mints a new code", async () => {
    setup(true);
    await screen.findByText("Online");
    await userEvent.click(screen.getByRole("button", { name: "Link a device" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Waiting for the device/);
    await act(async () => vi.advanceTimersByTime(301_000));
    expect(within(dialog).getByText("This code expired.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "New code" }));
    expect(await within(dialog).findByText(/Waiting for the device/)).toBeInTheDocument();
  });
});

describe("devices", () => {
  it("lists, renames and revokes with confirmation, and signs out all", async () => {
    setup(true);
    await screen.findByText("Online");
    await act(async () => {
      await pair("Safari on iPhone");
      await pair("Chrome on Mac");
    });
    await refresh();
    const list = await screen.findByRole("list", { name: "Devices" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Rename Chrome on Mac" }));
    const input = screen.getByLabelText("Device name");
    await userEvent.clear(input);
    await userEvent.type(input, "Work laptop{Enter}");
    expect(await screen.findByText("Work laptop")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Revoke Safari on iPhone" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke" }),
    );
    await waitFor(() => expect(screen.queryByText("Safari on iPhone")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Sign out all" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sign out all" }),
    );
    expect(await screen.findByText("No devices are linked yet.")).toBeInTheDocument();
  });
});

describe("settings search", () => {
  it("indexes the three remote entries", () => {
    const ids = SETTINGS_INDEX.map((entry) => entry.id);
    for (const id of ["remote-access", "link-device", "devices"]) expect(ids).toContain(id);
  });
});
