import { ERROR_STATUS, routes } from "@tau/protocol";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { filterProxyPath } from "./nodes/path-filter";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const startBody = (extra: Record<string, unknown> = {}) => ({
  projectId: "p1",
  text: "hello",
  requestId: "r-1",
  ...extra,
});

async function addProject() {
  const project = await ctx.core.projects.add({ path: "/Users/demo/project" });
  return project.id;
}

describe("GET /api/runtimes", () => {
  it("answers 200 with a schema-valid list: pi enabled, claude-code disabled with a reason", async () => {
    ctx = await startTestServer();

    const response = await ctx.request({ url: "/api/runtimes" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(routes.listRuntimes.response, body)).toBe(true);
    expect(
      body.executors.map((entry: { executor: string; enabled: boolean }) => [entry.executor, entry.enabled]),
    ).toEqual([
      ["pi", true],
      ["claude-code", false],
    ]);
    expect(body.executors[1].reason).toBe("Claude Code is not installed on this node");
  });

  it("is reachable through a node hub like the other node-scoped routes", () => {
    expect(filterProxyPath("GET", "/api/runtimes")).toMatchObject({ allowed: true });
  });
});

describe("POST /api/conversations with an executor", () => {
  it("rejects claude-code with 400 invalid_request when native is disabled, creating nothing", async () => {
    ctx = await startTestServer();
    const projectId = await addProject();

    const response = await ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: startBody({ projectId, executor: "claude-code" }),
    });

    expect(response.statusCode).toBe(ERROR_STATUS.invalid_request);
    expect(response.json().error).toMatchObject({
      code: "invalid_request",
      message: "Claude Code is not installed on this node",
    });
    expect(await ctx.core.conversations.list(projectId)).toEqual([]);
  });

  it.each([{}, { executor: "pi" }])("starts a Pi thread as before for %j", async (extra) => {
    ctx = await startTestServer();
    const projectId = await addProject();

    const response = await ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: startBody({ projectId, ...extra }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().executor).toBeUndefined();
  });

  it("rejects an unknown executor at the schema", async () => {
    ctx = await startTestServer();
    const projectId = await addProject();

    const response = await ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: startBody({ projectId, executor: "codex" }),
    });

    expect(response.statusCode).toBe(ERROR_STATUS.invalid_request);
  });
});
