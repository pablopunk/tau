import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

describe("access routes with the master token on loopback", () => {
  it("mints a pairing code with an empty or a JSON body", async () => {
    ctx = await startTestServer();
    const bare = await ctx.request({ method: "POST", url: "/api/pair" });
    const typed = await ctx.request({ method: "POST", url: "/api/pair?kind=node" });
    expect(bare.statusCode, bare.body).toBe(200);
    expect(typed.json()).toMatchObject({ kind: "node", link: null });
  });

  it("lists, renames, revokes and signs out all", async () => {
    ctx = await startTestServer();
    const minted = (await ctx.request({ method: "POST", url: "/api/pair" })).json();
    const redeem = await ctx.request({
      method: "POST",
      url: "/api/pair/redeem",
      payload: { code: minted.shortCode, deviceName: "Laptop" },
    });
    expect(redeem.statusCode).toBe(200);
    const [device] = (await ctx.request({ url: "/api/access/devices" })).json();
    expect(device).toMatchObject({ name: "Laptop", current: false });
    expect(
      (
        await ctx.request({
          method: "PUT",
          url: `/api/access/devices/${device.id}`,
          payload: { name: "Desk" },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await ctx.request({ method: "POST", url: "/api/access/sign-out-all", payload: {} })).statusCode,
    ).toBe(204);
    expect((await ctx.request({ url: "/api/access/devices" })).json()).toEqual([]);
  });

  it("answers remote status, on and off", async () => {
    ctx = await startTestServer();
    expect((await ctx.request({ url: "/api/remote" })).json().state).toBe("off");
    expect((await ctx.request({ method: "POST", url: "/api/remote/enable" })).json().state).toBe("online");
    expect((await ctx.request({ method: "POST", url: "/api/remote/disable" })).json().state).toBe("off");
  });
});
