import { afterEach, describe, expect, it } from "vitest";
import { makeStaticDir, startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const html = { accept: "text/html" };

describe("static assets", () => {
  it("serves files and falls back to index.html for app routes", async () => {
    ctx = await startTestServer({ staticDir: makeStaticDir() });
    expect((await ctx.request({ url: "/app.js" })).body).toContain("console.log");
    const route = await ctx.request({ url: "/p/1/c/2", headers: html });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain("id=root");
  });

  it("does not fall back to the app for unknown API routes or non-HTML requests", async () => {
    ctx = await startTestServer({ staticDir: makeStaticDir() });
    const api = await ctx.request({ url: "/api/nope", headers: html });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe("not_found");
    expect((await ctx.request({ url: "/missing.js" })).statusCode).toBe(404);
  });

  it("serves the API only without a static dir", async () => {
    ctx = await startTestServer();
    expect((await ctx.request({ url: "/", headers: html })).statusCode).toBe(404);
  });
});
