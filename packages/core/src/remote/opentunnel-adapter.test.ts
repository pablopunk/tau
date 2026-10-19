import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const state = {
    identity: undefined as { hostname: string } | undefined,
    connect: (): Promise<unknown> => new Promise(() => undefined),
    removeFails: false,
    pending: undefined as { hostname: string } | undefined,
    resumed: 0,
    created: 0,
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
        resume: async (o: { profile: string; onProgress?: (stage: string) => void }) => {
          if (!sdk.pending) return undefined;
          sdk.resumed += 1;
          o.onProgress?.("waiting-certificate");
          sdk.identity = sdk.pending;
          sdk.saved.set(o.profile, sdk.identity);
          return sdk.identity;
        },
        create: async (o: { profile: string }) => {
          sdk.created += 1;
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
    sdk.pending = undefined;
    sdk.resumed = 0;
    sdk.created = 0;
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

  it("disable only closes: the identity is kept and enable reuses the URL", async () => {
    const { adapter } = setup();
    await adapter.enable();
    await settle();
    const off = await adapter.disable();
    expect(off).toMatchObject({ state: "off", url: "https://abc.test" });
    expect(sdk.removed).toEqual([]);
    expect((await adapter.enable()).state).toBe("starting");
  });

  it("a restart mid-creation resumes the pending tunnel and reports its stage", async () => {
    sdk.identity = undefined;
    sdk.pending = { hostname: "pending.test" };
    const { adapter } = setup();
    await adapter.resume({ enabled: true });
    await settle();
    expect(sdk.resumed).toBe(1);
    expect(sdk.created).toBe(0);
    expect(adapter.status()).toMatchObject({ state: "starting", url: "https://pending.test" });
    expect(adapter.status().message).toContain("certificate");
  });
});
