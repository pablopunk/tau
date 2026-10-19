import { routes, type UpdateStatus } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { startTunneledServer, TUNNEL_HOSTNAME, type TunneledServer } from "../testing/tunnel-harness";
import { updateStatusFor } from "./register-routes";

let ctx: TunneledServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const OWNER_ONLY = [routes.startUpdate];
const BODY = { target: "1.0.0", force: false };
const SECRET: UpdateStatus = {
  current: "0.9.0",
  latest: "0.9.1",
  checkedAt: 1,
  behind: true,
  canUpdate: true,
  install: { mode: "manual", command: "npm i -g @pablopunk/tau@latest", reason: "npx" },
  job: { state: "failed", target: "0.9.1", error: "boom", logTail: "/home/u/.npm/_logs" },
};
const seeAs = (cookie: string) => ({ cookie, origin: `https://${TUNNEL_HOSTNAME}` });

describe("owner-only routes against a real server", () => {
  it.each(OWNER_ONLY.map((route) => [route.path, route] as const))("%s", async (_path, route) => {
    ctx = await startTunneledServer();
    ctx.core.updates.start = async () => SECRET;
    const owner = await ctx.request({ method: route.method, url: route.path, payload: BODY });
    expect(owner.statusCode).toBe(202);
    const device = await ctx.linkDevice();
    const viaDevice = await ctx.tunnel({
      method: route.method,
      path: route.path,
      headers: { ...seeAs(device.cookie), "content-type": "application/json" },
      body: JSON.stringify(BODY),
    });
    expect(viaDevice.status).toBe(403);
    expect(JSON.parse(viaDevice.body).error.code).toBe("forbidden");
    const node = await ctx.linkNode();
    const viaNode = await ctx.request({
      method: route.method,
      url: route.path,
      payload: BODY,
      headers: { cookie: "", authorization: `Bearer ${node.secret}` },
    });
    expect(viaNode.statusCode).toBeGreaterThanOrEqual(401);
    expect(viaNode.statusCode).toBeLessThan(500);
  });

  it("rejects the pre-auth empty device id", () => {
    expect(updateStatusFor(SECRET, "").canUpdate).toBe(false);
  });
});

describe("update status redaction", () => {
  it("gives the owner the status as core returned it", () => {
    expect(updateStatusFor(SECRET, "owner")).toEqual(SECRET);
  });

  it("hides command and logTail and canUpdate from everyone else", () => {
    const seen = updateStatusFor(SECRET, "device-1");
    expect(seen.canUpdate).toBe(false);
    expect(seen.install).toEqual({ ...SECRET.install, command: null });
    expect(seen.job).toEqual({ ...SECRET.job, logTail: null });
  });

  it("redacts GET and refresh for a paired device, not for the owner", async () => {
    ctx = await startTunneledServer();
    ctx.core.updates.status = async () => SECRET;
    ctx.core.updates.refresh = async () => SECRET;
    const device = await ctx.linkDevice();
    for (const route of [routes.getUpdateStatus, routes.refreshUpdateStatus]) {
      const owner = await ctx.request({ method: route.method, url: route.path });
      expect(owner.json()).toEqual(SECRET);
      const other = await ctx.tunnel({
        method: route.method,
        path: route.path,
        headers: seeAs(device.cookie),
      });
      expect(JSON.parse(other.body)).toMatchObject({
        canUpdate: false,
        install: { command: null },
        job: { logTail: null },
      });
    }
  });

  it("redacts the startUpdate response for non-owners too", () => {
    expect(updateStatusFor(SECRET, "node-1").job.logTail).toBeNull();
  });
});
