import type { Core } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type RunningServer } from "../create-server";

const TOKEN = "rotate-test-token-0123456789abcdef";
let server: RunningServer | undefined;
let core: Core | undefined;
afterEach(async () => {
  await server?.close();
  await core?.close();
});

async function start(onTokenRotated?: (token: string) => Promise<void>) {
  core = createFakeCore({ configured: true, speed: 1000 });
  server = await createServer({ core, port: 0, token: TOKEN, onTokenRotated });
  const headers = (token: string) => ({
    host: `127.0.0.1:${server?.port}`,
    authorization: `Bearer ${token}`,
  });
  const call = (token: string, url: string, method: "GET" | "POST" = "GET", payload?: object) =>
    (server as RunningServer).app.inject({ method, url, payload, headers: headers(token) });
  return { core, call };
}

describe("POST /api/access/rotate", () => {
  it("revokes the devices not kept, writes then swaps the token, and returns the new one once", async () => {
    const written: string[] = [];
    const { core: c, call } = await start(async (token) => void written.push(token));
    const mint = async (kind: "device" | "node", name: string) =>
      c.access.redeemPairing({
        code: (await c.access.mintPairing({ kind })).code,
        deviceName: name,
        peer: "203.0.113.7",
      });
    const keptNode = await mint("node", "homelab");
    const hostile = await mint("node", "hostile");
    const response = await call(TOKEN, "/api/access/rotate", "POST", { keep: [keptNode.deviceId] });
    expect(response.statusCode, response.body).toBe(200);
    const { revoked, token } = response.json();
    expect(revoked).toEqual([{ id: hostile.deviceId, name: "hostile", kind: "node" }]);
    expect(written).toEqual([token]);
    expect((await call(TOKEN, "/api/access/devices")).statusCode).toBe(401);
    expect((await call(token, "/api/access/devices")).statusCode).toBe(200);
    expect(await c.access.verifyNode(hostile.secret)).toBeUndefined();
    expect(await c.access.verifyNode(keptNode.secret)).toBeDefined();
  });

  it("keeps the old token when it cannot be written", async () => {
    const { call } = await start(async () => Promise.reject(new Error("disk full")));
    expect((await call(TOKEN, "/api/access/rotate", "POST", {})).statusCode).toBe(500);
    expect((await call(TOKEN, "/api/access/devices")).statusCode).toBe(200);
  });
});

describe("Step 2 node routes", () => {
  it("serves the directory and expulsions, and maps remove's refusals to their codes", async () => {
    const { call, core: c } = await start();
    expect((await call(TOKEN, "/api/nodes/directory")).json()).toEqual([]);
    expect((await call(TOKEN, "/api/nodes/expulsions")).json()).toEqual([]);
    const self = await c.nodes.self();
    const refused = await call(TOKEN, `/api/nodes/${self.nodeId}/remove`, "POST", { confirm: "Mac" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("cannot_remove_self");
    const noConfirm = await call(TOKEN, "/api/nodes/someone/remove", "POST", {});
    expect(noConfirm.statusCode).toBe(400);
  });
});
