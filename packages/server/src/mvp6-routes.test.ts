import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

async function startThread(text: string) {
  const project = await ctx.core.projects.add({ path: "/Users/demo/project" });
  const response = await ctx.request({
    method: "POST",
    url: "/api/conversations",
    payload: { projectId: project.id, text, requestId: `r-${text}`, workspace: "checkout" },
  });
  expect(response.statusCode).toBe(201);
  return { project, thread: response.json() as { id: string } };
}

async function untilChildOf(projectId: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const list = (await ctx.request({ url: `/api/projects/${projectId}/conversations` })).json();
    const child = list.find((item: { parentId: string | null }) => item.parentId !== null);
    if (child) return child as { id: string };
    if (Date.now() > deadline) throw new Error("Timed out waiting for the child");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("stop-agent route", () => {
  it("summaries carry the agent fields with legacy defaults", async () => {
    ctx = await startTestServer();
    const { thread } = await startThread("hello");
    expect(thread).toMatchObject({ agentType: null, agentModel: null, agentStatus: null, background: false });
  });

  it("answers 204 for a child", async () => {
    ctx = await startTestServer();
    const { project } = await startThread("task look around");
    const child = await untilChildOf(project.id);
    const response = await ctx.request({ method: "POST", url: `/api/conversations/${child.id}/stop-agent` });
    expect(response.statusCode).toBe(204);
  });

  it("answers 400 for a thread that is not a child and 404 for an unknown one", async () => {
    ctx = await startTestServer();
    const { thread } = await startThread("hello");
    const parent = await ctx.request({ method: "POST", url: `/api/conversations/${thread.id}/stop-agent` });
    expect(parent.statusCode).toBe(400);
    expect(parent.json().error.code).toBe("invalid_request");
    const unknown = await ctx.request({ method: "POST", url: "/api/conversations/nope/stop-agent" });
    expect(unknown.statusCode).toBe(404);
  });
});
