import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer, TOKEN } from "../testing/harness";

let ctx: TestServer | undefined;
afterEach(async () => {
  await ctx?.server.close();
  await ctx?.core.close();
  ctx = undefined;
});

describe("local metrics route", () => {
  it("reports only route templates to the owner, not raw URLs", async () => {
    ctx = await startTestServer();
    await ctx.request({ url: "/api/projects?private=never-store-this" });
    const response = await ctx.request({
      url: "/api/metrics",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ scope: "local", intervalMs: 10_000 });
    expect(response.json().requests).toContainEqual(
      expect.objectContaining({ method: "GET", route: "/api/projects", count: 1, errors: 0 }),
    );
    expect(response.body).not.toContain("never-store-this");
    const next = await ctx.request({
      url: "/api/metrics",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(next.json().requests).not.toContainEqual(expect.objectContaining({ route: "/api/metrics" }));
  });

  it("rejects a paired device, not just unauthenticated requests", async () => {
    ctx = await startTestServer();
    const pairing = await ctx.core.access.mintPairing({ kind: "device" });
    const redeem = await ctx.request({
      method: "POST",
      url: "/api/pair/redeem",
      payload: { code: pairing.code, deviceName: "Phone" },
    });
    expect(redeem.statusCode).toBe(200);
    const cookie = String(redeem.headers["set-cookie"]).split(";")[0] ?? "";
    expect(cookie).toContain("tau_device=");
    const response = await ctx.request({ url: "/api/metrics", headers: { cookie } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("forbidden");
  });
});
