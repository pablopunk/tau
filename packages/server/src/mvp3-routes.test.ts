import { ERROR_STATUS, isIconPng } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness";

it("maps the new error codes", async () => {
  ctx = await startTestServer();
  expect(ERROR_STATUS.github_unavailable).toBe(409);
  expect(ERROR_STATUS.needs_folder).toBe(409);
  expect(ERROR_STATUS.remote_mismatch).toBe(422);
});

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];

function iconBytes(): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from(PNG_HEADER).copy(bytes);
  bytes.writeUInt32BE(128, 16);
  bytes.writeUInt32BE(128, 20);
  return bytes;
}

describe("MVP3 routes", () => {
  it("serves GitHub status, repos and use", async () => {
    ctx = await startTestServer();
    expect((await ctx.request({ url: "/api/github/status" })).json()).toMatchObject({ state: "connected" });
    const repos = (await ctx.request({ url: "/api/github/repos" })).json();
    expect(repos[0]).toHaveProperty("nameWithOwner");
    expect((await ctx.request({ method: "POST", url: "/api/github/repos/refresh" })).statusCode).toBe(200);
    const used = await ctx.request({
      method: "POST",
      url: "/api/github/use",
      payload: { nameWithOwner: "demo/tau", mode: "local" },
    });
    expect(used.statusCode).toBe(201);
    expect(used.json()).toMatchObject({ kind: "folder" });
    const missing = await ctx.request({
      method: "POST",
      url: "/api/github/use",
      payload: { nameWithOwner: "demo/api-server", mode: "local" },
    });
    expect(missing.statusCode).toBe(409);
  });

  it("answers a null code folder suggestion as JSON null", async () => {
    ctx = await startTestServer();
    const response = await ctx.request({ url: "/api/settings/suggested-code-folder" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
  });

  it("stores, serves and resets a project icon", async () => {
    ctx = await startTestServer();
    const project = (
      await ctx.request({ method: "POST", url: "/api/projects", payload: { path: "/Users/demo/project" } })
    ).json();
    const url = `/api/projects/${project.id}/icon`;
    expect((await ctx.request({ url })).statusCode).toBe(404);
    const put = await ctx.request({ method: "PUT", url, payload: { png: iconBytes().toString("base64") } });
    expect(put.statusCode).toBe(204);
    const image = await ctx.request({ url });
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["x-content-type-options"]).toBe("nosniff");
    expect(isIconPng(new Uint8Array(image.rawPayload))).toBe(true);
    const cached = await ctx.request({ url, headers: { "if-none-match": String(image.headers.etag) } });
    expect(cached.statusCode).toBe(304);
    expect((await ctx.request({ method: "DELETE", url })).statusCode).toBe(204);
    expect((await ctx.request({ url })).statusCode).toBe(404);
  });

  it("lists icon candidates and 404s an unknown candidate name", async () => {
    ctx = await startTestServer();
    const project = (
      await ctx.request({ method: "POST", url: "/api/projects", payload: { path: "/Users/demo/project" } })
    ).json();
    expect((await ctx.request({ url: `/api/projects/${project.id}/icon-candidates` })).json()).toEqual([]);
    const file = await ctx.request({
      url: `/api/projects/${project.id}/icon-candidates/file?name=public%2Ffavicon.ico`,
    });
    expect(file.statusCode).toBe(404);
    const noName = await ctx.request({ url: `/api/projects/${project.id}/icon-candidates/file` });
    expect(noName.statusCode).toBe(400);
  });
});
