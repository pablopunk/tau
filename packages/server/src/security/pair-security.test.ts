import { afterEach, describe, expect, it } from "vitest";
import { startTunneledServer, TUNNEL_HOSTNAME, type TunneledServer } from "../testing/tunnel-harness";

let ctx: TunneledServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const ORIGIN = `https://${TUNNEL_HOSTNAME}`;
const JSON_HEADERS = { "content-type": "application/json", origin: ORIGIN };

const redeem = (code: string, peer?: string) =>
  ctx.tunnel({
    method: "POST",
    path: "/api/pair/redeem",
    body: JSON.stringify({ code, deviceName: "Phone" }),
    headers: JSON_HEADERS,
    peer,
  });

describe("pair page on both sockets", () => {
  it("is served with the same headers on an untagged loopback socket, with no cookie", async () => {
    ctx = await startTunneledServer();
    const response = await ctx.server.app.inject({
      url: "/pair",
      headers: { host: `127.0.0.1:${ctx.server.port}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("script-src 'sha256-");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("is served on a tagged socket with no cookie and no session", async () => {
    ctx = await startTunneledServer();
    const response = await ctx.tunnel({ path: "/pair" });
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["content-type"]).toContain("text/html");
  });
});

describe("redeem answers without leaking", () => {
  it("answers a locked peer exactly like a wrong code: generic 401, same body, no cookie", async () => {
    ctx = await startTunneledServer();
    const minted = await ctx.core.access.mintPairing({ kind: "device" });
    const wrong = await redeem("nope", "198.51.100.20");
    for (let index = 0; index < 5; index++) await redeem("nope", "198.51.100.20");
    const locked = await redeem(minted.code, "198.51.100.20");
    expect(locked.status).toBe(wrong.status);
    expect(locked.body).toBe(wrong.body);
    expect(locked.headers["set-cookie"]).toBeUndefined();
    expect(JSON.parse(locked.body)).toEqual({
      error: { code: "unauthorized", message: "That code did not work." },
    });
  });

  it("does not echo the code, the peer or the device name", async () => {
    ctx = await startTunneledServer();
    const response = await redeem("secret-guess-123", "198.51.100.21");
    for (const text of ["secret-guess-123", "198.51.100.21", "Phone"])
      expect(response.body).not.toContain(text);
  });
});

describe("device cookie on the guard", () => {
  it("is Secure only on a tagged socket; always HttpOnly and SameSite=Strict", async () => {
    ctx = await startTunneledServer();
    const tagged = await redeem((await ctx.core.access.mintPairing({ kind: "device" })).code);
    const local = await ctx.server.app.inject({
      method: "POST",
      url: "/api/pair/redeem",
      payload: { code: (await ctx.core.access.mintPairing({ kind: "device" })).code, deviceName: "Laptop" },
      headers: { host: `127.0.0.1:${ctx.server.port}`, origin: ctx.server.origin },
    });
    const taggedCookie = String(tagged.headers["set-cookie"]);
    const localCookie = String(local.headers["set-cookie"]);
    for (const cookie of [taggedCookie, localCookie]) {
      expect(cookie).toMatch(/^tau_device=/);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
    }
    expect(taggedCookie).toContain("Secure");
    expect(localCookie).not.toContain("Secure");
  });

  it("is not set by a forged X-Forwarded-Proto on a loopback socket", async () => {
    ctx = await startTunneledServer();
    const response = await ctx.server.app.inject({
      method: "POST",
      url: "/api/pair/redeem",
      payload: { code: (await ctx.core.access.mintPairing({ kind: "device" })).code, deviceName: "x" },
      headers: {
        host: `127.0.0.1:${ctx.server.port}`,
        origin: ctx.server.origin,
        "x-forwarded-proto": "https",
      },
    });
    expect(String(response.headers["set-cookie"])).not.toContain("Secure");
  });
});
