import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startTestServer, type TestServer } from "../testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

describe("server.attachPeer (frozen seam, stub until owner B)", () => {
  it("is on the running server and reports why a link ended", async () => {
    ctx = await startTestServer();
    const echo = new WebSocket(`ws://127.0.0.1:${ctx.server.port}/api/health`);
    echo.on("error", () => undefined);
    const handle = ctx.server.attachPeer(echo, "dialler", { peerId: "u-abc", secretKey: "h" });
    echo.terminate();
    const closed = await handle.closed;
    expect(closed).toMatchObject({ linked: false, bye: false });
  });
});
