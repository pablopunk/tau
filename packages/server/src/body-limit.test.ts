import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const MiB = 1024 * 1024;
const bigText = (mib: number) => "x".repeat(mib * MiB);

describe("body limits", () => {
  it("accepts 10 MiB on POST /conversations and rejects 43 MiB as too_large", async () => {
    ctx = await startTestServer();
    const url = "/api/conversations";
    const ok = await ctx.request({
      method: "POST",
      url,
      payload: { projectId: "home", text: bigText(10), requestId: "ok" },
    });
    expect(ok.statusCode).toBe(201);
    const huge = await ctx.request({
      method: "POST",
      url,
      payload: { projectId: "home", text: bigText(43), requestId: "big" },
    });
    expect(huge.statusCode).toBe(413);
    expect(huge.json().error.code).toBe("too_large");
  });

  it("accepts 10 MiB on POST /conversations/:id/messages and rejects 43 MiB", async () => {
    ctx = await startTestServer();
    const created = await ctx.request({
      method: "POST",
      url: "/api/conversations",
      payload: { projectId: "home", text: "hi", requestId: "s" },
    });
    const url = `/api/conversations/${created.json().id}/messages`;
    const ok = await ctx.request({ method: "POST", url, payload: { text: bigText(10), requestId: "a" } });
    expect(ok.statusCode).toBe(204);
    const huge = await ctx.request({ method: "POST", url, payload: { text: bigText(43), requestId: "b" } });
    expect(huge.statusCode).toBe(413);
    expect(huge.json().error.code).toBe("too_large");
  });

  it("keeps the default limit on other routes", async () => {
    ctx = await startTestServer();
    const huge = await ctx.request({
      method: "POST",
      url: "/api/projects/clone",
      payload: { url: `https://example.com/${bigText(2)}.git` },
    });
    expect(huge.statusCode).toBe(413);
    expect(huge.json().error.code).toBe("too_large");
  });
});
