import { routes } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { handleError } from "../error-handler";
import { OWNER_DEVICE_ID } from "../security/guard";
import { startTestServer, type TestServer } from "../testing/harness";
import { defineRoute } from "./define-route";

let ctx: TestServer | undefined;
afterEach(async () => {
  await ctx?.server.close();
  await ctx?.core.close();
  ctx = undefined;
});

async function callAs(deviceId: string) {
  const app = Fastify();
  app.setErrorHandler(handleError);
  app.decorateRequest("deviceId", "");
  app.addHook("onRequest", async (request) => {
    request.deviceId = deviceId;
  });
  const core = createFakeCore({ configured: true });
  core.updates.start = async () => core.updates.status();
  defineRoute(app, routes.startUpdate, ({ body }) => core.updates.start(body), { ownerOnly: true });
  const response = await app.inject({
    method: "POST",
    url: routes.startUpdate.path,
    payload: { target: "1.0.0", force: false },
  });
  await app.close();
  return response;
}

describe("ownerOnly routes", () => {
  it.each(["", "device-123", "node-link-abc"])("rejects %j with forbidden", async (deviceId) => {
    const response = await callAs(deviceId);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("forbidden");
  });

  it("lets the owner through with 202", async () => {
    expect((await callAs(OWNER_DEVICE_ID)).statusCode).toBe(202);
  });

  it("startUpdate rejects extra and missing body fields", async () => {
    ctx = await startTestServer();
    for (const payload of [{ target: "1.0.0", force: false, extra: 1 }, { target: "1.0.0" }]) {
      const response = await ctx.request({ method: "POST", url: "/api/update/start", payload });
      expect(response.statusCode).toBe(400);
    }
  });
});
