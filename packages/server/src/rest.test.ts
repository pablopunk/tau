import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

describe("REST routes", () => {
  it("maps settings and provider routes to core", async () => {
    ctx = await startTestServer({ fake: { configured: false } });
    const providers = (await ctx.request({ url: "/api/providers" })).json();
    expect(providers.map((provider: { connection: unknown }) => provider.connection)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect((await ctx.request({ url: "/api/models" })).json()).toEqual([]);
    const put = await ctx.request({
      method: "PUT",
      url: "/api/providers/openrouter/key",
      payload: { key: "sk-test" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ id: "openrouter", connection: { method: "api_key", source: "file" } });
    const models = (await ctx.request({ url: "/api/models" })).json();
    expect(models.length).toBeGreaterThan(0);
    const { provider, modelId } = models[0];
    const set = await ctx.request({
      method: "PUT",
      url: "/api/settings/default-model",
      payload: { provider, modelId },
    });
    expect(set.statusCode).toBe(204);
    expect((await ctx.request({ url: "/api/settings" })).json()).toMatchObject({
      defaultModel: { provider, modelId },
    });
  });

  it("maps the Claude CLI notice and refresh routes to core", async () => {
    ctx = await startTestServer({ fake: { configured: false } });
    const refreshed = await ctx.request({ method: "POST", url: "/api/providers/claude-cli/refresh" });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).toMatchObject({ id: "claude-cli", cli: { state: "needs_notice" } });
    const noticed = await ctx.request({ method: "POST", url: "/api/providers/claude-cli/notice" });
    expect(noticed.statusCode).toBe(200);
    expect(noticed.json()).toMatchObject({ id: "claude-cli", cli: { state: "ready" } });
    expect((await ctx.request({ url: "/api/settings" })).json().claudeCliNoticeAt).toEqual(
      expect.any(Number),
    );
  });

  it("runs the project and conversation lifecycle", async () => {
    ctx = await startTestServer();
    const added = await ctx.request({
      method: "POST",
      url: "/api/projects",
      payload: { path: "/Users/demo/project" },
    });
    expect(added.statusCode).toBe(201);
    const project = added.json();
    const renamed = await ctx.request({
      method: "PATCH",
      url: `/api/projects/${project.id}`,
      payload: { name: "Renamed" },
    });
    expect(renamed.statusCode).toBe(204);
    expect((await ctx.request({ url: "/api/projects" })).json()[1].name).toBe("Renamed");

    const created = await ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: { projectId: project.id, text: "hello", requestId: "start-1" },
    });
    expect(created.statusCode).toBe(201);
    const conversation = created.json();
    expect((await ctx.request({ url: `/api/projects/${project.id}/conversations` })).json()).toHaveLength(1);
    expect((await ctx.request({ url: "/api/conversations" })).json()).toHaveLength(1);
    expect(
      (
        await ctx.request({
          method: "PATCH",
          url: `/api/conversations/${conversation.id}`,
          payload: { title: "Hello" },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await ctx.request({
          method: "POST",
          url: `/api/conversations/${conversation.id}/messages`,
          payload: { text: "hi", requestId: "r1" },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await ctx.request({ method: "POST", url: `/api/conversations/${conversation.id}/abort` })).statusCode,
    ).toBe(204);
    expect((await ctx.request({ method: "DELETE", url: `/api/projects/${project.id}` })).statusCode).toBe(
      204,
    );
  });

  it("maps the MVP2 routes to core", async () => {
    ctx = await startTestServer({ fake: { configured: true } });
    const put = (url: string, payload: unknown) => ctx.request({ method: "PUT", url, payload });
    expect((await put("/api/settings/fast-model", { model: null })).statusCode).toBe(204);
    expect((await put("/api/settings/projects-folder", { path: "/Users/demo/projects" })).statusCode).toBe(
      204,
    );
    const cloned = await ctx.request({
      method: "POST",
      url: "/api/projects/clone",
      payload: { url: "https://example.com/demo/ok.git" },
    });
    expect(cloned.statusCode).toBe(201);
    expect(cloned.json()).toMatchObject({ kind: "git", status: "cloning" });
    expect(
      (await ctx.request({ method: "POST", url: `/api/projects/${cloned.json().id}/retry-clone` }))
        .statusCode,
    ).toBe(400);
    const started = await ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: { projectId: "home", text: "hello", requestId: "start-2" },
    });
    const { id } = started.json();
    expect((await put(`/api/conversations/${id}/archived`, { archived: true })).statusCode).toBe(204);
    const retry = await ctx.request({
      method: "POST",
      url: `/api/conversations/${id}/retry`,
      payload: { requestId: "retry-1" },
    });
    expect(retry.statusCode).toBe(400);
    const patch = (payload: object, thread = id) =>
      ctx.request({ method: "PATCH", url: `/api/conversations/${thread}/agent`, payload });
    expect((await patch({ model: { provider: "faux", modelId: "faux-2" } })).statusCode).toBe(204);
    expect((await patch({ thinkingLevel: "low" })).statusCode).toBe(204);
    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ model: { provider: "faux", modelId: "nope" } })).statusCode).toBe(400);
    expect((await patch({ thinkingLevel: "low" }, "nope")).statusCode).toBe(404);
    expect((await ctx.request({ method: "DELETE", url: `/api/conversations/${id}` })).statusCode).toBe(204);
  });

  it("answers a body over the limit with a too_large error", async () => {
    ctx = await startTestServer({ fake: { configured: true } });
    const huge = await ctx.request({
      method: "PUT",
      url: "/api/providers/openrouter/key",
      payload: { key: "x".repeat(2 * 1024 * 1024) },
    });
    expect(huge.statusCode).toBe(413);
    expect(huge.json().error.code).toBe("too_large");
  });

  it("turns AppError into the protocol error body with its status", async () => {
    ctx = await startTestServer();
    const missing = await ctx.request({ url: "/api/projects/nope/conversations" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: { code: "not_found", message: expect.any(String) } });
    const body = { path: "/Users/demo/project" };
    await ctx.request({ method: "POST", url: "/api/projects", payload: body });
    const duplicate = await ctx.request({ method: "POST", url: "/api/projects", payload: body });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("duplicate_project");
    const gone = await ctx.request({
      method: "POST",
      url: "/api/projects",
      payload: { path: "/does/not/exist" },
    });
    expect(gone.statusCode).toBe(422);
    expect(gone.json().error.code).toBe("path_not_found");
    const file = await ctx.request({
      method: "POST",
      url: "/api/projects",
      payload: { path: "/Users/demo/notes.txt" },
    });
    expect(file.json().error.code).toBe("not_a_directory");
  });

  it("rejects invalid bodies and params as invalid_request", async () => {
    ctx = await startTestServer();
    const wrongShape = await ctx.request({ method: "POST", url: "/api/projects", payload: { path: 5 } });
    expect(wrongShape.statusCode).toBe(400);
    expect(wrongShape.json().error.code).toBe("invalid_request");
    const malformed = await ctx.request({
      method: "PUT",
      url: "/api/providers/openrouter/key",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("invalid_request");
    const missingBody = await ctx.request({
      method: "POST",
      url: "/api/projects",
      headers: { "content-type": "application/json" },
    });
    expect(missingBody.json().error.code).toBe("invalid_request");
  });

  it("answers unknown API routes with a not_found error body", async () => {
    ctx = await startTestServer();
    const response = await ctx.request({ url: "/api/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });

  it("hides unexpected failures behind an internal error", async () => {
    const { createFakeCore } = await import("@tau/testkit");
    const core = createFakeCore({ configured: true });
    core.projects.list = async () => {
      throw new Error("secret detail");
    };
    ctx = await startTestServer({ core });
    const response = await ctx.request({ url: "/api/projects" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: "internal", message: "Internal error" } });
  });
});
