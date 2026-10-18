import { AppError, ERROR_STATUS, type ErrorCode } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const CALLBACK_URL = "http://127.0.0.1:1455/auth/callback?code=ok&state=faux";

describe("error codes", () => {
  it("maps the MVP4 codes", async () => {
    ctx = await startTestServer();
    expect(ERROR_STATUS.login_failed).toBe(422);
    expect(ERROR_STATUS.nothing_to_compact).toBe(409);
  });
});

describe("provider routes", () => {
  it("connects and disconnects a provider, and lists its models", async () => {
    ctx = await startTestServer({ fake: { configured: false } });
    const put = await ctx.request({
      method: "PUT",
      url: "/api/providers/anthropic/key",
      payload: { key: "sk-ant" },
    });
    expect(put.json()).toMatchObject({ id: "anthropic", connection: { method: "api_key" } });
    expect((await ctx.request({ url: "/api/models" })).json()[0]).toHaveProperty("providerName");
    const removed = await ctx.request({ method: "DELETE", url: "/api/providers/anthropic" });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ id: "anthropic", connection: null });
    expect((await ctx.request({ url: "/api/models" })).json()).toEqual([]);
  });

  it("rejects an unknown provider id and an empty key", async () => {
    ctx = await startTestServer({ fake: { configured: false } });
    const unknown = await ctx.request({
      method: "PUT",
      url: "/api/providers/nope/key",
      payload: { key: "k" },
    });
    expect(unknown.statusCode).toBe(400);
    const empty = await ctx.request({
      method: "PUT",
      url: "/api/providers/openai/key",
      payload: { key: "" },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("invalid_request");
  });

  it("answers invalid_key as 422", async () => {
    const core = createFakeCore();
    core.providers.setApiKey = async () => {
      throw new AppError("invalid_key", "nope");
    };
    ctx = await startTestServer({ core });
    const response = await ctx.request({
      method: "PUT",
      url: "/api/providers/google/key",
      payload: { key: "k" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("invalid_key");
  });
});

describe("login routes", () => {
  it("runs a ChatGPT sign-in from start to done", async () => {
    ctx = await startTestServer({ fake: { configured: false } });
    const started = await ctx.request({ method: "POST", url: "/api/providers/openai/login" });
    expect(started.statusCode).toBe(201);
    const session = started.json();
    expect(session).toMatchObject({ provider: "openai", method: "chatgpt", state: "waiting" });
    expect((await ctx.request({ url: `/api/logins/${session.id}` })).json()).toEqual(session);
    const wrong = await ctx.request({
      method: "POST",
      url: `/api/logins/${session.id}/url`,
      payload: { url: "http://example.com/x" },
    });
    expect(wrong.json()).toMatchObject({ state: "waiting", error: expect.any(String) });
    const done = await ctx.request({
      method: "POST",
      url: `/api/logins/${session.id}/url`,
      payload: { url: CALLBACK_URL },
    });
    expect(done.json()).toMatchObject({ state: "done", error: null });
    const providers = (await ctx.request({ url: "/api/providers" })).json();
    expect(providers.find((provider: { id: string }) => provider.id === "openai").connection).toMatchObject({
      method: "chatgpt",
    });
  });

  it("cancels a sign-in, and answers not_found for an unknown one", async () => {
    ctx = await startTestServer({ fake: { configured: false } });
    const session = (await ctx.request({ method: "POST", url: "/api/providers/openai/login" })).json();
    expect((await ctx.request({ method: "DELETE", url: `/api/logins/${session.id}` })).statusCode).toBe(204);
    expect((await ctx.request({ url: `/api/logins/${session.id}` })).json().state).toBe("cancelled");
    const missing = await ctx.request({ url: "/api/logins/nope" });
    expect(missing.statusCode).toBe(404);
  });

  it("refuses a sign-in for a provider without one", async () => {
    ctx = await startTestServer({ fake: { configured: false } });
    const response = await ctx.request({ method: "POST", url: "/api/providers/anthropic/login" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it("answers login_failed as 422 and rejects a body that is too long", async () => {
    const core = createFakeCore();
    core.providers.submitLoginUrl = async () => {
      throw new AppError("login_failed", "over");
    };
    ctx = await startTestServer({ core });
    const failed = await ctx.request({ method: "POST", url: "/api/logins/x/url", payload: { url: "u" } });
    expect(failed.statusCode).toBe(422);
    const tooLong = await ctx.request({
      method: "POST",
      url: "/api/logins/x/url",
      payload: { url: "u".repeat(5000) },
    });
    expect(tooLong.statusCode).toBe(400);
  });
});

describe("composer routes", () => {
  it("suggests files of a project, and answers not_found for an unknown project", async () => {
    ctx = await startTestServer({
      fake: { fs: { "/Users/demo/project": "directory", "/Users/demo/project/src/app.ts": "file" } },
    });
    const added = (
      await ctx.request({ method: "POST", url: "/api/projects", payload: { path: "/Users/demo/project" } })
    ).json();
    const suggest = (id: string, query: string) =>
      ctx.request({ method: "POST", url: `/api/projects/${id}/files/suggest`, payload: { query } });
    expect((await suggest(added.id, "app")).json()[0]).toEqual({ path: "src/app.ts", kind: "file" });
    expect((await suggest(added.id, "../")).json()).toEqual([]);
    expect((await suggest("nope", "a")).statusCode).toBe(404);
  });

  it("lists skills with and without a project", async () => {
    const skill = {
      name: "demo",
      description: "Demo.",
      scope: "user" as const,
      path: "~/.agents/skills/demo/SKILL.md",
    };
    ctx = await startTestServer({ fake: { skills: [skill] } });
    expect((await ctx.request({ url: "/api/skills" })).json()).toEqual([skill]);
    expect((await ctx.request({ url: "/api/skills?projectId=home" })).json()).toEqual([skill]);
    expect((await ctx.request({ url: "/api/skills?projectId=nope" })).statusCode).toBe(404);
  });

  it("compacts a thread, and maps nothing_to_compact to 409", async () => {
    ctx = await startTestServer();
    const started = await ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: { projectId: "home", text: "hello", requestId: "r1" },
    });
    const { id } = started.json();
    const compact = (thread: string, payload: object = {}) =>
      ctx.request({ method: "POST", url: `/api/conversations/${thread}/compact`, payload });
    const tooShort = await compact(id);
    expect(tooShort.statusCode).toBe(409);
    expect(tooShort.json().error.code).toBe("nothing_to_compact" satisfies ErrorCode);
    expect((await compact("nope")).statusCode).toBe(404);
    expect((await compact(id, { instructions: "x".repeat(2001) })).statusCode).toBe(400);
  });
});
