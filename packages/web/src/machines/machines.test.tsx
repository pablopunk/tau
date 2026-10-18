import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetMachineApis, MachineProvider, useApi, useMachineApi, useMachineId, useMachines } from ".";

const urls: string[] = [];

class FakeSocket extends EventTarget {
  constructor(url: string) {
    super();
    urls.push(url);
  }
  close() {}
  send() {}
}

beforeEach(() => {
  urls.length = 0;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  forgetMachineApis();
});

describe("MachineProvider", () => {
  it("gives each machine its own api, id, QueryClient and live socket under /api/m/<id>", async () => {
    const seen: Record<string, { id: string | undefined; client: QueryClient }> = {};
    const Probe = ({ name }: { name: string }) => {
      const client = useQueryClient();
      const id = useMachineId();
      const api = useApi();
      seen[name] = { id, client };
      void api.projects.list();
      return null;
    };
    render(
      <>
        <MachineProvider machineId="m1">
          <Probe name="one" />
        </MachineProvider>
        <MachineProvider machineId="m2">
          <Probe name="two" />
        </MachineProvider>
        <MachineProvider>
          <Probe name="local" />
        </MachineProvider>
      </>,
    );
    await waitFor(() => expect(urls.filter((url) => url.endsWith("/api/projects"))).toHaveLength(3));
    expect(urls).toEqual(
      expect.arrayContaining(["/api/m/m1/api/projects", "/api/m/m2/api/projects", "/api/projects"]),
    );
    expect(seen.one?.id).toBe("m1");
    expect(seen.local?.id).toBeUndefined();
    expect(new Set([seen.one?.client, seen.two?.client, seen.local?.client]).size).toBe(3);
    const sockets = urls.filter((url) => url.startsWith("ws://")).map((url) => new URL(url).pathname);
    expect(sockets.sort()).toEqual(["/api/live", "/api/m/m1/api/live", "/api/m/m2/api/live"]);
  });

  it("useApi needs a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useApi())).toThrow(/MachineProvider/);
    spy.mockRestore();
  });
});

describe("MachineRegistry", () => {
  it("useMachineApi returns one client per machine and the local api for undefined", () => {
    const { result } = renderHook(() => [
      useMachineApi("m1"),
      useMachineApi("m1"),
      useMachineApi("m2"),
      useMachineApi(),
    ]);
    const [a, b, c, local] = result.current;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(local).not.toBe(a);
  });

  it("useMachines lists the hub's machines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMachines(), { wrapper });
    await act(async () => undefined);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.machines).toEqual([]);
  });
});
