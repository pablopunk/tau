import { ERROR_STATUS, FileRefSchema, routes, UPLOAD_BODY_LIMIT, UploadInputSchema } from "@tau/protocol";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestServer } from "../testing/harness";
import { startTunneledServer, TUNNEL_HOSTNAME } from "../testing/tunnel-harness";

let ctx: TestServer | undefined;
afterEach(async () => {
  await ctx?.server.close();
  await ctx?.core.close();
  ctx = undefined;
});

const bodyOf = (data: string) => ({ name: "notes.txt", mimeType: "text/plain", data });
const tiny = () => bodyOf(Buffer.from("hello").toString("base64"));

describe("stageUpload route", () => {
  it("is an owner-only JSON route with an 8 MiB body limit", () => {
    expect(routes.stageUpload).toMatchObject({
      method: "POST",
      path: "/api/uploads",
      status: 201,
      body: UploadInputSchema,
      response: FileRefSchema,
      bodyLimit: UPLOAD_BODY_LIMIT,
      ownerOnly: true,
    });
    expect(UPLOAD_BODY_LIMIT).toBe(8 * 1024 * 1024);
  });

  it("stages for the owner and returns the FileRef", async () => {
    ctx = await startTestServer();
    const response = await ctx.request({ method: "POST", url: "/api/uploads", payload: tiny() });
    expect(response.statusCode).toBe(201);
    expect(Value.Check(FileRefSchema, response.json())).toBe(true);
    expect(response.json()).toMatchObject({ name: "notes.txt", size: 5 });
  });

  it("rejects a non-owner with forbidden and never calls Core", async () => {
    const tunneled = await startTunneledServer();
    ctx = tunneled;
    const stage = vi.spyOn(tunneled.core.uploads, "stage");
    const device = await tunneled.linkDevice();
    const denied = await tunneled.tunnel({
      method: "POST",
      path: "/api/uploads",
      headers: {
        cookie: device.cookie,
        origin: `https://${TUNNEL_HOSTNAME}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(tiny()),
    });
    expect(denied.status).toBe(ERROR_STATUS.forbidden);
    expect(JSON.parse(denied.body).error.code).toBe("forbidden");
    expect(stage).not.toHaveBeenCalled();
  });

  it("rejects a body past the route limit with too_large", async () => {
    ctx = await startTestServer();
    const response = await ctx.request({
      method: "POST",
      url: "/api/uploads",
      payload: bodyOf("a".repeat(UPLOAD_BODY_LIMIT)),
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(ERROR_STATUS.too_large);
    expect(response.json().error.code).toBe("too_large");
  });

  it("lets Core answer too_large for a valid body carrying more than 5 MiB of file bytes", async () => {
    ctx = await startTestServer();
    const over = Buffer.alloc(5 * 1024 * 1024 + 1, 7).toString("base64");
    expect(over.length).toBeLessThan(UPLOAD_BODY_LIMIT);
    const response = await ctx.request({ method: "POST", url: "/api/uploads", payload: bodyOf(over) });
    expect(response.statusCode).toBe(ERROR_STATUS.too_large);
    expect(response.json().error.code).toBe("too_large");
  });

  it("rejects a malformed body with invalid_request", async () => {
    ctx = await startTestServer();
    const response = await ctx.request({ method: "POST", url: "/api/uploads", payload: { name: "x" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });
});
