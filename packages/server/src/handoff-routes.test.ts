import {
  AppError,
  type ConversationSummary,
  type Core,
  ERROR_STATUS,
  emptyHandoffLosses,
  HANDOFF_INSTRUCTION_MAX_LENGTH,
  type HandoffInput,
  HandoffPreviewSchema,
  routes,
} from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { filterProxyPath } from "./nodes/path-filter";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const NATIVE_OFF = "native Claude is not enabled on this node";

async function startWithPiThread() {
  ctx = await startTestServer();
  const project = await ctx.core.projects.add({ path: "/Users/demo/project" });
  const thread = await ctx.core.conversations.start({
    projectId: project.id,
    text: "hello",
    requestId: "pi-1",
  });
  return { project, thread };
}

/** The fake core never has native on; this one answers a handoff, to see what the routes pass and return. */
function coreThatHandsOff() {
  const fake = createFakeCore({ configured: true, speed: 1000 });
  const calls: { id: string; input: HandoffInput }[] = [];
  let created: ConversationSummary | undefined;
  const core: Core = {
    ...fake,
    conversations: {
      ...fake.conversations,
      async handoffPreview() {
        return {
          canHandoff: true,
          losses: { ...emptyHandoffLosses(), imagesOmitted: 2, exportedChars: 5 },
          preview: "User: hi",
        };
      },
      async handoff(id, input) {
        calls.push({ id, input });
        const [source] = await fake.conversations.listAll();
        created = {
          ...(source as ConversationSummary),
          id: "900",
          title: "Handoff: hello",
          executor: "claude-code",
        };
        return created;
      },
    },
  };
  return { core, calls, created: () => created };
}

describe("GET /api/conversations/:id/handoff-preview", () => {
  it("answers 200 with a schema-valid preview that says why a handoff cannot run now", async () => {
    const { thread } = await startWithPiThread();

    const response = await ctx.request({ url: `/api/conversations/${thread.id}/handoff-preview` });

    expect(response.statusCode).toBe(200);
    expect(Value.Check(routes.getHandoffPreview.response, response.json())).toBe(true);
    expect(response.json()).toMatchObject({ canHandoff: false, reason: NATIVE_OFF, preview: "" });
  });

  it("answers 404 not_found for an unknown thread", async () => {
    ctx = await startTestServer();

    const response = await ctx.request({ url: "/api/conversations/nope/handoff-preview" });

    expect(response.statusCode).toBe(ERROR_STATUS.not_found);
    expect(response.json().error.code).toBe("not_found");
  });

  it("passes the core's preview through unchanged", async () => {
    const fake = coreThatHandsOff();
    ctx = await startTestServer({ core: fake.core });

    const response = await ctx.request({ url: "/api/conversations/1/handoff-preview" });

    expect(Value.Check(HandoffPreviewSchema, response.json())).toBe(true);
    expect(response.json()).toMatchObject({
      canHandoff: true,
      losses: { imagesOmitted: 2 },
      preview: "User: hi",
    });
  });
});

describe("POST /api/conversations/:id/handoff", () => {
  it("answers 201 with the new thread and forwards the body to the core", async () => {
    const fake = coreThatHandsOff();
    ctx = await startTestServer({ core: fake.core });
    const project = await ctx.core.projects.add({ path: "/Users/demo/project" });
    await ctx.core.conversations.start({ projectId: project.id, text: "hello", requestId: "pi-1" });

    const response = await ctx.request({
      method: "POST",
      url: "/api/conversations/7/handoff",
      payload: { requestId: "h-1", instruction: "carry on" },
    });

    expect(response.statusCode).toBe(201);
    expect(Value.Check(routes.handoffConversation.response, response.json())).toBe(true);
    expect(response.json()).toMatchObject({ id: "900", executor: "claude-code", title: "Handoff: hello" });
    expect(fake.calls).toEqual([{ id: "7", input: { requestId: "h-1", instruction: "carry on" } }]);
  });

  it("answers 400 invalid_request while native is off and creates no thread", async () => {
    const { project, thread } = await startWithPiThread();

    const response = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/handoff`,
      payload: { requestId: "h-1" },
    });

    expect(response.statusCode).toBe(ERROR_STATUS.invalid_request);
    expect(response.json().error).toMatchObject({ code: "invalid_request", message: NATIVE_OFF });
    expect(await ctx.core.conversations.list(project.id)).toHaveLength(1);
  });

  it("answers 409 thread_busy when the core says the source still works", async () => {
    const fake = coreThatHandsOff();
    const busy: Core = {
      ...fake.core,
      conversations: {
        ...fake.core.conversations,
        handoff: () => Promise.reject(new AppError("thread_busy", "this thread is running")),
      },
    };
    ctx = await startTestServer({ core: busy });

    const response = await ctx.request({
      method: "POST",
      url: "/api/conversations/7/handoff",
      payload: { requestId: "h-1" },
    });

    expect(response.statusCode).toBe(ERROR_STATUS.thread_busy);
    expect(response.json().error).toMatchObject({ code: "thread_busy", message: "this thread is running" });
  });

  it.each([
    ["no requestId", {}],
    ["an empty requestId", { requestId: "" }],
    [
      "an over-long instruction",
      { requestId: "r", instruction: "x".repeat(HANDOFF_INSTRUCTION_MAX_LENGTH + 1) },
    ],
  ])("rejects %s before the core is called", async (_name, payload) => {
    const fake = coreThatHandsOff();
    ctx = await startTestServer({ core: fake.core });

    const response = await ctx.request({ method: "POST", url: "/api/conversations/7/handoff", payload });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(fake.calls).toEqual([]);
  });
});

describe("handoff routes through a node hub", () => {
  it("are reachable like the other conversation routes", () => {
    expect(filterProxyPath("GET", "/api/conversations/7/handoff-preview")).toMatchObject({ allowed: true });
    expect(filterProxyPath("POST", "/api/conversations/7/handoff")).toMatchObject({ allowed: true });
  });
});
