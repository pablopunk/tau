import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const suggest = (payload: unknown) => ctx.request({ method: "POST", url: "/api/fs/suggest", payload });

describe("POST /api/fs/suggest", () => {
  it("returns suggestions with ~ display and the repo flag", async () => {
    ctx = await startTestServer();
    const response = await suggest({ prefix: "~/src/ta" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ path: "/Users/demo/src/tau", display: "~/src/tau", isGitRepo: true }]);
  });

  it("honours the limit and gives [] for a missing folder", async () => {
    ctx = await startTestServer();
    expect((await suggest({ prefix: "~/src/", limit: 2 })).json()).toHaveLength(2);
    expect((await suggest({ prefix: "/nowhere/x" })).json()).toEqual([]);
  });

  it("rejects a body without a prefix", async () => {
    ctx = await startTestServer();
    expect((await suggest({})).statusCode).toBe(400);
  });
});
