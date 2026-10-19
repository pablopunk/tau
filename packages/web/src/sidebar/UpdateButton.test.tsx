import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IDLE_JOB, type UpdateInstall, type UpdateJob, type UpdateStatus } from "@tau/protocol";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { resetUpdateMemory, UPDATED_KEY } from "@/lib/updates";
import { NodeApiProvider } from "@/nodes/node-context";
import { conversation } from "./test-support";
import { UpdateButton } from "./UpdateButton";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RUN: UpdateInstall = { mode: "run", command: null, reason: null };
const NPM_I = "npm i -g @pablopunk/tau@latest && tau restart";
const manual = (reason: string, command: string | null = NPM_I): UpdateInstall => ({
  mode: "manual",
  command,
  reason,
});

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: "0.9.0",
  latest: "0.10.12",
  checkedAt: 1,
  behind: true,
  canUpdate: true,
  install: RUN,
  job: IDLE_JOB,
  ...overrides,
});
const job = (state: UpdateJob["state"], extra: Partial<UpdateJob> = {}): UpdateJob => ({
  state,
  target: "0.10.12",
  error: null,
  logTail: null,
  ...extra,
});

const reload = vi.fn();
const start = vi.fn();
let listAll = vi.fn();

function setup(initial: UpdateStatus) {
  const api = {
    updates: { status: vi.fn().mockResolvedValue(initial), start },
    conversations: { listAll },
  } as unknown as Api;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NodeApiProvider api={api}>
        <UpdateButton />
      </NodeApiProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUpdateMemory();
  window.sessionStorage.clear();
  listAll = vi.fn().mockResolvedValue([]);
  start.mockResolvedValue(status({ job: job("installing") }));
  Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true });
});
afterEach(() => vi.useRealTimers());

const button = () => screen.findByRole("button", { name: /update/i });

describe("install matrix", () => {
  it.each([
    ["npm global", RUN],
    ["pnpm global", RUN],
    ["mise/asdf npm", RUN],
    [
      "foreground (not a service)",
      {
        ...RUN,
        reason: "tau was not started as a service, so it will not restart. Restart it yourself afterwards.",
      },
    ],
  ])("%s: confirms, then starts the shown version", async (_name, install) => {
    setup(status({ install }));
    await userEvent.click(await button());
    expect(await screen.findByText("Update tau to 0.10.12?")).toBeInTheDocument();
    expect(screen.getByText(/You have 0.9.0/)).toBeInTheDocument();
    if (install.reason) expect(screen.getByText(/will not restart/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Update and restart" }));
    expect(start).toHaveBeenCalledWith({ target: "0.10.12", force: false });
  });

  it.each([
    ["npx / dlx cache", manual("it runs from the npx cache")],
    ["Windows", manual("Windows cannot replace a running tau")],
    ["bun / volta", manual("it was installed with bun", "bun add -g @pablopunk/tau@latest && tau restart")],
  ])("%s: shows the command and runs nothing", async (_name, install) => {
    setup(status({ install }));
    await userEvent.click(await button());
    expect(await screen.findByText("Update tau")).toBeInTheDocument();
    expect(screen.getByText(install.command as string)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it("dev checkout: hidden", async () => {
    setup(status({ install: { mode: "none", command: null, reason: "dev" } }));
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });

  it("not behind and idle: hidden", async () => {
    setup(status({ behind: false, latest: "0.9.0" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("jobs", () => {
  it.each(["installing", "restarting"] as const)("%s: Updating… and disabled", async (state) => {
    setup(status({ job: job(state) }));
    expect(await screen.findByRole("button", { name: "Updating…" })).toBeDisabled();
  });

  it("failed shows even when not behind, with the log tail and no Retry for manual", async () => {
    setup(
      status({ behind: false, install: manual("npx"), job: job("failed", { logTail: "npm error E404" }) }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Update failed" }));
    expect(await screen.findByText("npm error E404")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("failed with mode run and behind offers Retry, which asks again", async () => {
    setup(status({ job: job("failed", { logTail: "boom" }) }));
    await userEvent.click(await screen.findByRole("button", { name: "Update failed" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Update tau to 0.10.12?")).toBeInTheDocument();
  });

  it("warns about running work and forces after confirming", async () => {
    listAll.mockResolvedValue([
      conversation({ id: "a", status: "running" }),
      conversation({ id: "b", status: "running" }),
      conversation({ id: "s", parentId: "a", agentStatus: "running", timers: 1 }),
    ]);
    setup(status());
    await userEvent.click(await button());
    expect(
      await screen.findByText(
        "2 threads and 1 subagent are running. They will be stopped. Threads with timers or a goal resume afterwards.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop work and update" }));
    expect(start).toHaveBeenCalledWith({ target: "0.10.12", force: true });
  });
});

describe("reload", () => {
  it("a fresh page with idle and target === current does not reload", async () => {
    setup(status({ current: "0.10.12", behind: false, job: job("idle") }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once when current changes, even for a non-owner who never sees the button", async () => {
    const client = setup(status({ canUpdate: false }));
    await waitFor(() => expect(client.getQueryData(queryKeys.updateStatus)).toBeDefined());
    expect(screen.queryByRole("button")).toBeNull();
    act(() =>
      client.setQueryData(
        queryKeys.updateStatus,
        status({ canUpdate: false, current: "0.10.12", behind: false }),
      ),
    );
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(UPDATED_KEY)).toBeNull();
  });

  it("the tab that started the update leaves a toast for the new page", async () => {
    const client = setup(status());
    await userEvent.click(await button());
    await userEvent.click(await screen.findByRole("button", { name: "Update and restart" }));
    act(() => client.setQueryData(queryKeys.updateStatus, status({ current: "0.10.12", behind: false })));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(window.sessionStorage.getItem(UPDATED_KEY)).toBe("0.10.12");
  });

  it("shows the toast once after the reload", async () => {
    window.sessionStorage.setItem(UPDATED_KEY, "0.10.12");
    setup(status({ current: "0.10.12", behind: false }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("tau updated to 0.10.12"));
    expect(window.sessionStorage.getItem(UPDATED_KEY)).toBeNull();
  });
});
