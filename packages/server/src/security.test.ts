import { afterEach, describe, expect, it } from "vitest";
import { makeStaticDir, startTestServer, type TestServer, TOKEN } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const rawRequest = (url: string, headers: Record<string, string>, method: "GET" | "POST" = "GET") =>
  ctx.server.app.inject({ method, url, headers });

describe("Host allow-list", () => {
  it("accepts 127.0.0.1 and localhost on the bound port", async () => {
    ctx = await startTestServer();
    const { port } = ctx.server;
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
      expect((await ctx.request({ url: "/api/settings", headers: { host } })).statusCode).toBe(200);
    }
  });

  it("rejects other hosts and ports (DNS rebinding)", async () => {
    ctx = await startTestServer();
    for (const host of ["evil.example:4317", `evil.example:${ctx.server.port}`, "127.0.0.1:1", "127.0.0.1"]) {
      expect((await ctx.request({ url: "/api/settings", headers: { host } })).statusCode).toBe(403);
    }
  });
});

describe("Origin check", () => {
  it("rejects non-GET requests with a foreign or missing origin", async () => {
    ctx = await startTestServer();
    const payload = { name: "x" };
    for (const origin of ["http://evil.example", "http://127.0.0.1:1", "https://127.0.0.1", ""]) {
      const response = await ctx.request({
        method: "PATCH",
        url: "/api/projects/p",
        payload,
        headers: { origin },
      });
      expect(response.statusCode).toBe(403);
    }
    const { origin: _origin, ...withoutOrigin } = ctx.headers;
    const missing = await rawRequest("/api/projects/p/conversations", withoutOrigin, "POST");
    expect(missing.statusCode).toBe(403);
  });

  it("accepts the exact origin on both local names", async () => {
    ctx = await startTestServer();
    const { port } = ctx.server;
    for (const name of ["127.0.0.1", "localhost"]) {
      const response = await ctx.request({
        method: "POST",
        url: "/api/projects",
        payload: { path: "/Users/demo/project" },
        headers: { host: `${name}:${port}`, origin: `http://${name}:${port}` },
      });
      expect([201, 409]).toContain(response.statusCode);
    }
  });

  it("does not require an origin on GET", async () => {
    ctx = await startTestServer();
    const { origin: _origin, ...withoutOrigin } = ctx.headers;
    expect((await rawRequest("/api/settings", withoutOrigin)).statusCode).toBe(200);
  });
});

describe("Content type", () => {
  it("requires application/json on bodies", async () => {
    ctx = await startTestServer();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const response = await ctx.request({
        method: "PUT",
        url: "/api/providers/openrouter/key",
        payload: '{"key":"k"}',
        headers: { "content-type": type },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("invalid_request");
    }
  });

  it("accepts a charset parameter", async () => {
    ctx = await startTestServer();
    const response = await ctx.request({
      method: "PUT",
      url: "/api/providers/openrouter/key",
      payload: '{"key":"k"}',
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("Token and cookie", () => {
  it("swaps ?token= for an HttpOnly SameSite=Strict pie_<port> cookie and answers with a same-origin page", async () => {
    ctx = await startTestServer();
    const { port } = ctx.server;
    const response = await rawRequest(`/?token=${TOKEN}&x=1`, { host: `127.0.0.1:${port}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('location.replace("/")');
    expect(response.body).not.toContain(TOKEN);
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toContain(`pie_${port}=${TOKEN}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("does not exchange a wrong token", async () => {
    ctx = await startTestServer();
    const response = await rawRequest("/?token=wrong", { host: `127.0.0.1:${ctx.server.port}` });
    expect(response.statusCode).toBe(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("answers API calls without the cookie with unauthorized", async () => {
    ctx = await startTestServer();
    const { cookie: _cookie, ...withoutCookie } = ctx.headers;
    const response = await rawRequest("/api/settings", withoutCookie);
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");
    const wrong = await rawRequest("/api/settings", {
      ...withoutCookie,
      cookie: `pie_${ctx.server.port}=nope`,
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("ignores a token passed to the API", async () => {
    ctx = await startTestServer();
    const response = await rawRequest(`/api/settings?token=${TOKEN}`, {
      host: `127.0.0.1:${ctx.server.port}`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("shows a plain 'open the URL printed in your terminal' page without the cookie", async () => {
    ctx = await startTestServer({ staticDir: makeStaticDir() });
    const response = await rawRequest("/p/1/c/2", {
      host: `127.0.0.1:${ctx.server.port}`,
      accept: "text/html",
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Open the URL printed in your terminal");
    expect(response.body).not.toContain("id=root");
  });
});
