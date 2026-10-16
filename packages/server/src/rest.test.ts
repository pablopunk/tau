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
    expect((await ctx.request({ url: "/api/provider" })).json()).toMatchObject({ configured: false });
    expect((await ctx.request({ url: "/api/models" })).statusCode).toBe(409);
    const put = await ctx.request({ method: "PUT", url: "/api/provider/key", payload: { key: "sk-test" } });
    expect(put.statusCode).toBe(204);
    expect(put.body).toBe("");
    const models = (await ctx.request({ url: "/api/models" })).json();
    expect(models.length).toBeGreaterThan(0);
    const { provider, modelId } = models[0];
    const set = await ctx.request({
      method: "PUT",
      url: "/api/settings/default-model",
      payload: { provider, modelId },
    });
    expect(set.statusCode).toBe(204);
    expect((await ctx.request({ url: "/api/settings" })).json()).toEqual({
      defaultModel: { provider, modelId },
    });
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
    expect((await ctx.request({ url: "/api/projects" })).json()[0].name).toBe("Renamed");

    const created = await ctx.request({ method: "POST", url: `/api/projects/${project.id}/conversations` });
    expect(created.statusCode).toBe(201);
    const conversation = created.json();
    expect((await ctx.request({ url: `/api/projects/${project.id}/conversations` })).json()).toHaveLength(1);
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
      url: "/api/provider/key",
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
    const { createFakeCore } = await import("@pi-everywhere/testkit");
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
