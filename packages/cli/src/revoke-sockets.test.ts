import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "@tau/core";
import { createServer } from "@tau/server";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

const closed = (socket: WebSocket) =>
  new Promise<number>((done) => socket.addEventListener("close", (event) => done(event.code)));

it("revoking a device closes its open /live socket (real core, real server)", async () => {
  vi.stubEnv("TAU_FAKE_REMOTE", "1");
  const home = join(mkdtempSync(join(tmpdir(), "tau-revoke-")), "home");
  const core = await createCore({
    home,
    faux: true,
    currentVersion: "0.0.0",
    latestVersion: async () => "0.0.0",
    tunnelTarget: async () => "127.0.0.1:1",
  });
  const server = await createServer({ core, port: 0, token: "t".repeat(32) });
  const owner = { authorization: `Bearer ${"t".repeat(32)}` };
  try {
    await core.remote.enable();
    const minted = (await (
      await fetch(`${server.origin}/api/pair?name=Probe`, { method: "POST", headers: owner })
    ).json()) as { link: string; shortCode: string };
    expect(minted.link).toMatch(/\/pair#[0-9a-f]+\.Probe$/);
    const redeem = await fetch(`${server.origin}/api/pair/redeem`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: server.origin,
        "user-agent": "Mozilla/5.0 (iPhone) Safari/605.1",
      },
      body: JSON.stringify({ code: minted.shortCode, deviceName: "" }),
    });
    const cookie = (redeem.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const { deviceId } = (await redeem.json()) as { deviceId: string };
    const [device] = await core.access.listDevices();
    expect(device?.name).toBe("Safari on iPhone");
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/live`, {
      headers: { cookie, origin: server.origin },
    } as never);
    await new Promise((open) => socket.addEventListener("open", open));
    const ended = closed(socket);
    await fetch(`${server.origin}/api/access/devices/${deviceId}`, { method: "DELETE", headers: owner });
    expect(await ended).toBe(1008);
    expect((await fetch(`${server.origin}/api/settings`, { headers: { cookie } })).status).toBe(401);
  } finally {
    await server.close();
    await core.close();
  }
});
