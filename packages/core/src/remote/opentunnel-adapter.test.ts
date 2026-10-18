import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const state = {
    identity: undefined as { hostname: string } | undefined,
    connect: (): Promise<unknown> => new Promise(() => undefined),
    removeFails: false,
    removed: [] as string[],
    saved: new Map<string, unknown>(),
  };
  return state;
});

vi.mock("@opentunnel/client", () => {
  const storage = {
    profiles: async () => [...sdk.saved.keys()],
    save: async (profile: string, identity: unknown) => void sdk.saved.set(profile, identity),
    remove: async (profile: string) => void sdk.saved.delete(profile),
  };
  return {
    OpenTunnelStorage: { xdg: () => storage },
    create: () => ({
      tunnel: {
        get: async (o: { profile: string }) => sdk.saved.get(o.profile) ?? sdk.identity,
        resume: async () => undefined,
        create: async (o: { profile: string }) => {
          sdk.identity = { hostname: "newhost.test" };
          sdk.saved.set(o.profile, sdk.identity);
          return sdk.identity;
        },
        remove: async (o: { profile: string }) => {
          if (sdk.removeFails) throw new Error("ENOTFOUND relay raw text");
          sdk.removed.push(o.profile);
          sdk.saved.delete(o.profile);
        },
        connect: () => sdk.connect(),
      },
      dispose: async () => undefined,
    }),
  };
});

import { createOpenTunnelAdapter } from "./opentunnel-adapter";

function setup() {
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const adapter = createOpenTunnelAdapter({
    directory: "/tmp/never-used",
    tunnelTarget: async () => "127.0.0.1:1",
    now: () => 1,
    schedule: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  return { adapter, timers };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("opentunnel adapter over a fake SDK", () => {
  beforeEach(() => {
    sdk.identity = { hostname: "abc.test" };
    sdk.connect = () => new Promise(() => undefined);
    sdk.removeFails = false;
    sdk.removed = [];
    sdk.saved = new Map([["x", 1]]);
    sdk.saved.clear();
  });

  it("enable returns starting at once even when connect hangs, then says it cannot reach the service", async () => {
    const { adapter, timers } = setup();
    const status = await adapter.enable();
    expect(status.state).toBe("starting");
    await settle();
    for (const t of timers.filter((t) => t.live && t.ms === 15_000)) t.run();
    expect(adapter.status()).toMatchObject({
      state: "error",
      message: "Cannot reach the tunnel service",
      url: "https://abc.test",
    });
  });

  it("goes online when connect resolves and reconnecting on disconnect events", async () => {
    sdk.connect = async () => ({
      tunnel: { hostname: "abc.test" },
      events: (async function* () {
        yield { type: "disconnected", reason: "x" };
      })(),
      close: async () => undefined,
    });
    const { adapter } = setup();
    await adapter.enable();
    await settle();
    expect(adapter.status()).toMatchObject({ state: "reconnecting", url: "https://abc.test" });
  });

  it("disable that cannot remove keeps the identity as pending removal and retries later", async () => {
    sdk.saved.set("seed", 0);
    const { adapter, timers } = setup();
    sdk.saved.clear();
    await adapter.enable();
    await settle();
    sdk.saved.set(`tau-${"0".repeat(8)}`, sdk.identity);
    sdk.removeFails = true;
    const off = await adapter.disable();
    await settle();
    expect(off.state).toBe("off");
    expect(adapter.status().pendingRemoval).toBe(true);
    sdk.removeFails = false;
    for (const t of timers.filter((t) => t.live && t.ms === 300_000)) t.run();
    await settle();
    expect(adapter.status().pendingRemoval).toBe(false);
    expect(sdk.removed.some((p) => p.includes("-old-1"))).toBe(true);
  });
});
