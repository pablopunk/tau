import { AppError, ERROR_STATUS, type ErrorCode } from "@pi-everywhere/protocol";
import { createFakeCore } from "@pi-everywhere/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const failing = (code: ErrorCode) => async () => {
  throw new AppError(code, `boom ${code}`);
};

const MVP2_STATUSES: ReadonlyArray<[ErrorCode, number]> = [
  ["images_not_supported", 422],
  ["invalid_git_url", 422],
  ["too_large", 413],
  ["project_not_ready", 409],
  ["git_missing", 409],
];

describe("MVP2 error codes", () => {
  it.each(MVP2_STATUSES)("maps %s to HTTP %i", async (code, status) => {
    expect(ERROR_STATUS[code]).toBe(status);
    const core = createFakeCore({ configured: true });
    core.conversations.start = failing(code);
    core.projects.clone = failing(code);
    ctx = await startTestServer({ core });
    const start = await ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: { projectId: "home", text: "hi", requestId: "r1" },
    });
    expect(start.statusCode).toBe(status);
    expect(start.json()).toEqual({ error: { code, message: `boom ${code}` } });
    const clone = await ctx.request({
      method: "POST",
      url: "/api/projects/clone",
      payload: { url: "https://example.com/a.git" },
    });
    expect(clone.statusCode).toBe(status);
    expect(clone.json().error.code).toBe(code);
  });
});
