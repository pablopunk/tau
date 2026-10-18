import { LIVE_PATH, MESSAGE_BODY_LIMIT, routes, TERMINAL_STREAM_PATH } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { filterProxyPath, filterResponseHeaders, forwardableRequestHeaders } from "./path-filter";

const allowed = (method: string, path: string) => filterProxyPath(method, path);

describe("path filter: allowed", () => {
  it("accepts the exact method and path of a routes template", () => {
    const table: Array<[string, string]> = [
      ["GET", "/api/conversations"],
      ["GET", "/api/settings"],
      ["POST", "/api/conversations"],
      ["GET", "/api/projects/p1/conversations"],
      ["DELETE", "/api/projects/p%201"],
      ["PUT", "/api/settings/default-model"],
    ];
    for (const [method, path] of table)
      expect(allowed(method, path), `${method} ${path}`).toMatchObject({ allowed: true, path });
  });

  it("accepts every routes entry outside the denylist, with its own body limit", () => {
    const denied = /^\/api\/(access|remote|machines|pair|health)(\/|$)/;
    for (const [name, route] of Object.entries(routes)) {
      if (denied.test(route.path)) continue;
      const path = route.path.replace(/:\w+/g, "x1");
      const decision = allowed(route.method, path);
      expect(decision.allowed, name).toBe(true);
    }
    const message = allowed("POST", routes.sendMessage.path.replace(":id", "c1"));
    expect(message).toMatchObject({ allowed: true, target: { kind: "http", bodyLimit: MESSAGE_BODY_LIMIT } });
  });

  it("recognises the live socket and the terminal stream", () => {
    expect(allowed("GET", LIVE_PATH)).toMatchObject({ allowed: true, target: { kind: "live" } });
    expect(allowed("GET", TERMINAL_STREAM_PATH.replace(":id", "t%201"))).toMatchObject({
      allowed: true,
      target: { kind: "terminal-stream", terminalId: "t 1" },
    });
  });
});

describe("path filter: denied", () => {
  it("refuses the denylist with 403, whatever follows", () => {
    for (const path of [
      "/api/access/devices",
      "/api/access/devices/d1",
      "/api/remote",
      "/api/remote/enable",
      "/api/machines",
      "/api/machines/link",
      "/api/machines/m1",
      "/api/pair",
      "/api/pair/redeem",
      "/api/health",
      "/api/m/other/api/conversations",
    ]) {
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        expect(allowed(method, path), `${method} ${path}`).toMatchObject({ allowed: false, status: 403 });
      }
    }
  });

  it("refuses traversal and smuggling: .., %2e, %2f, //, a query or fragment in the path, backslash, control characters", () => {
    for (const path of [
      "/api/projects/../settings",
      "/api/projects/%2e%2e/settings",
      "/api/projects/%2E%2E/access/devices",
      "/api/projects/a%2fb/conversations",
      "/api/projects/a%2Fb/conversations",
      "/api//conversations",
      "/api/conversations?x=1",
      "/api/conversations#x",
      "/api/projects\\x",
      "/api/conversations%00",
      "/api/projects/a%5cb",
      "/api/conversations\n",
    ]) {
      expect(allowed("GET", path), path).toMatchObject({ allowed: false, status: 403 });
    }
  });

  it("refuses a bad percent-encoding", () => {
    expect(allowed("GET", "/api/projects/%E0%A4%A/conversations")).toMatchObject({
      allowed: false,
      status: 403,
    });
  });

  it("answers 404 for unknown paths, wrong methods, and trailing or missing segments", () => {
    for (const [method, path] of [
      ["GET", "/api/nope"],
      ["GET", "/"],
      ["GET", "/assets/app.js"],
      ["PATCH", "/api/conversations"],
      ["DELETE", "/api/settings"],
      ["GET", "/api/conversations/c1/extra/segments/that/never/match"],
      ["GET", "/api/projects//conversations".replace("//", "/x/y/")],
      ["GET", "/api/live/extra"],
      ["POST", "/api/live"],
      ["GET", "/api/terminals/t1/stream/more"],
      ["GET", "/api/terminals/stream"],
    ] as const) {
      expect(allowed(method, path), `${method} ${path}`).toMatchObject({ allowed: false, status: 404 });
    }
  });

  it("never matches a longer path against a shorter template", () => {
    expect(allowed("GET", "/api/projects/p1/conversations/extra").allowed).toBe(false);
    expect(allowed("GET", "/api/projects/p1/conversations").allowed).toBe(true);
  });
});

describe("header filters", () => {
  it("keeps only four response headers and drops set-cookie", () => {
    expect(
      filterResponseHeaders({
        "Content-Type": "application/json",
        "cache-control": "no-store",
        "content-disposition": "attachment",
        etag: '"x"',
        "set-cookie": "tau_device=stolen",
        "access-control-allow-origin": "*",
        location: "https://evil.example",
        "content-length": "9",
      }),
    ).toEqual({
      "content-type": "application/json",
      "cache-control": "no-store",
      "content-disposition": "attachment",
      etag: '"x"',
    });
  });

  it("never forwards Host, Origin, Cookie or Authorization", () => {
    expect(
      forwardableRequestHeaders({
        host: "hub.example",
        origin: "https://hub.example",
        cookie: "tau_device=x",
        authorization: "Bearer y",
        "content-type": "application/json",
        accept: "*/*",
        "x-forwarded-for": "1.2.3.4",
      }),
    ).toEqual({ "content-type": "application/json", accept: "*/*" });
  });
});
