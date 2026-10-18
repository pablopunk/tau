import { describe, expect, it } from "vitest";
import { executePair } from "./pair-command";
import { FakeTau, makeHome } from "./test-support";

const REMOTE_OFF = {
  state: "off",
  url: null,
  since: null,
  message: null,
  pendingRemoval: false,
  canRecreate: false,
};
const REMOTE_ON = { ...REMOTE_OFF, state: "online", url: "https://abc.opentunnel.xyz" };
const PAIRING = {
  kind: "device",
  code: "c0de",
  shortCode: "ABCD2345",
  link: "https://abc.opentunnel.xyz/pair#c0de",
  expiresAt: 5 * 60_000,
};

/** A clock that only moves when the command sleeps. */
function clockedEnv(tau: FakeTau, onSleep: (now: number) => void = () => undefined) {
  const clock = { now: 0 };
  const env = tau.env(makeHome(), {
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
      onSleep(clock.now);
    },
  });
  return { env, clock };
}

function scriptPairing(tau: FakeTau, remote: object = REMOTE_ON) {
  tau.answers.set("GET /api/remote", { status: 200, body: remote });
  tau.answers.set("GET /api/access/devices", { status: 200, body: [] });
  tau.answers.set("POST /api/pair?kind=device", { status: 200, body: PAIRING });
}

describe("tau pair", () => {
  it("prints the link with the name, the grouped code, a QR and the warning, then Linked", async () => {
    const tau = new FakeTau();
    scriptPairing(tau);
    const { env } = clockedEnv(tau, (now) => {
      if (now >= 6000) {
        tau.answers.set("GET /api/access/devices", {
          status: 200,
          body: [{ id: "d1", name: "Pablo's phone", kind: "phone" }],
        });
      }
    });
    await executePair(["--name", "my mac"], { ...env, home: env.home });
    const out = tau.stdout.join("\n");
    expect(out).toContain("https://abc.opentunnel.xyz/pair#c0de.my%20mac");
    expect(out).toContain("ABCD 2345");
    expect(out).toContain("full power");
    expect(out).toMatch(/[▀▄█]/);
    expect(tau.stdout.at(-1)).toBe("Linked: Pablo's phone");
    expect(tau.calls.every((call) => call.headers.authorization?.startsWith("Bearer "))).toBe(true);
  });

  it("times out when the code expires without a device", async () => {
    const tau = new FakeTau();
    scriptPairing(tau);
    const { env } = clockedEnv(tau);
    await expect(executePair([], env)).rejects.toThrow(/expired/);
  });

  it("turns remote on, explains the wait, and polls until online", async () => {
    const tau = new FakeTau();
    scriptPairing(tau, REMOTE_OFF);
    tau.answers.set("POST /api/remote/enable", {
      status: 200,
      body: { ...REMOTE_OFF, state: "starting", message: "Getting a certificate" },
    });
    const { env } = clockedEnv(tau, (now) => {
      if (now >= 3000)
        tau.answers.set("GET /api/remote", { status: 200, body: { ...REMOTE_OFF, state: "starting" } });
      if (now >= 9000) tau.answers.set("GET /api/remote", { status: 200, body: REMOTE_ON });
      if (now >= 20_000)
        tau.answers.set("GET /api/access/devices", { status: 200, body: [{ id: "d", name: "Tab" }] });
    });
    await executePair([], env);
    const out = tau.stdout.join("\n");
    expect(out).toContain("takes a few minutes");
    expect(out).toContain("Getting a certificate");
    expect(tau.calls.some((call) => call.method === "POST" && call.path.endsWith("/enable"))).toBe(true);
    expect(tau.stdout.at(-1)).toBe("Linked: Tab");
  });

  it("gives up waiting for the tunnel after 12 minutes", async () => {
    const tau = new FakeTau();
    scriptPairing(tau, { ...REMOTE_OFF, state: "starting" });
    const { env } = clockedEnv(tau);
    await expect(executePair([], env)).rejects.toThrow(/still starting/);
  });

  it("fails with the tunnel's message on error", async () => {
    const tau = new FakeTau();
    scriptPairing(tau, { ...REMOTE_OFF, state: "error", message: "Cannot reach the tunnel service" });
    const { env } = clockedEnv(tau);
    await expect(executePair([], env)).rejects.toThrow("Cannot reach the tunnel service");
  });

  it("refuses unknown arguments", async () => {
    const tau = new FakeTau();
    const { env } = clockedEnv(tau);
    await expect(executePair(["--bogus"], env)).rejects.toThrow(/Usage: tau pair/);
  });

  it("leaves `pair new` and help to the command table", async () => {
    const tau = new FakeTau();
    scriptPairing(tau);
    const { env } = clockedEnv(tau);
    tau.answers.set("POST /api/pair", { status: 200, body: PAIRING });
    await executePair(["new"], env);
    expect(JSON.parse(tau.stdout[0] ?? "")).toMatchObject({ shortCode: "ABCD2345" });
    await executePair(["--help"], env);
    expect(tau.stdout.at(-1)).toContain("pair");
  });
});

describe("remote and devices commands", () => {
  it("remote off and devices revoke need --yes", async () => {
    const { executeApiCommand } = await import("./run-command");
    const tau = new FakeTau();
    const env = tau.env(makeHome());
    await expect(executeApiCommand("remote", ["off"], env)).rejects.toThrow(/--yes/);
    await expect(executeApiCommand("devices", ["revoke", "d1"], env)).rejects.toThrow(/--yes/);
    await executeApiCommand("devices", ["revoke", "d1", "--yes"], env);
    expect(tau.calls.at(-1)).toMatchObject({ method: "DELETE" });
  });

  it("help lists the verbs", async () => {
    const { executeApiCommand } = await import("./run-command");
    const tau = new FakeTau();
    const env = tau.env(makeHome());
    await executeApiCommand("remote", ["--help"], env);
    await executeApiCommand("devices", ["--help"], env);
    const help = tau.stdout.join("\n");
    for (const verb of ["status", "on", "off", "list", "rename", "revoke"]) expect(help).toContain(verb);
  });
});
