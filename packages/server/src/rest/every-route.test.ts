import { routes } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

/** A route in `routes` that the server never registered answers "Unknown route": the web would call a dead URL. */
describe("every entry of routes is registered on the server", () => {
  it("answers something other than 404 'Unknown route' for each one", async () => {
    ctx = await startTestServer();
    const unknown: string[] = [];
    for (const [name, route] of Object.entries(routes)) {
      const response = await ctx.request({
        method: route.method,
        url: route.path.replace(/:\w+/g, "x1"),
        payload: route.method === "GET" || route.method === "DELETE" ? undefined : {},
      });
      if (response.statusCode === 404 && response.body.includes("Unknown route")) unknown.push(name);
    }
    expect(unknown).toEqual([]);
  });
});
