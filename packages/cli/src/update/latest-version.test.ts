import { describe, expect, it } from "vitest";
import type { RunCommand } from "./command-runner";
import { fetchLatestVersion } from "./latest-version";

const NPM = "/n/bin/npm";

/** `npm config get <key>` answers from `config`; a missing key prints `undefined` like npm does. */
const npmWith =
  (config: Record<string, string>): RunCommand =>
  async (_command, args) => ({ code: 0, stdout: `${config[args[2] ?? ""] ?? "undefined"}\n`, stderr: "" });

interface Routes {
  [url: string]: { status: number; body?: unknown } | Error;
}

function fakeFetch(routes: Routes) {
  const calls: string[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const route = routes[`${init?.method ?? "GET"} ${url}`];
    if (route === undefined) return new Response("not found", { status: 404 });
    if (route instanceof Error) throw route;
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const REG = "https://reg.example";
const goodRoutes = (registry = REG): Routes => ({
  [`GET ${registry}/@pablopunk%2ftau`]: { status: 200, body: { "dist-tags": { latest: "1.2.3" } } },
  [`GET ${registry}/@pablopunk%2ftau/1.2.3`]: {
    status: 200,
    body: { dist: { tarball: `${registry}/tau-1.2.3.tgz` } },
  },
  [`HEAD ${registry}/tau-1.2.3.tgz`]: { status: 200 },
});

const latest = (config: Record<string, string>, routes: Routes) => {
  const fetched = fakeFetch(routes);
  return { result: fetchLatestVersion(npmWith(config), "/n/bin/node", fetched.impl), calls: fetched.calls };
};

describe("fetchLatestVersion", () => {
  it("returns the tag when the document and the tarball both answer 200", async () => {
    const { result } = latest({ "@pablopunk:registry": REG }, goodRoutes());
    await expect(result).resolves.toBe("1.2.3");
  });

  it("falls back to `registry` when the scoped key prints `undefined` or nothing", async () => {
    for (const scoped of ["undefined", ""]) {
      const { result, calls } = latest({ "@pablopunk:registry": scoped, registry: REG }, goodRoutes());
      await expect(result).resolves.toBe("1.2.3");
      expect(calls[0]).toBe(`GET ${REG}/@pablopunk%2ftau`);
    }
  });

  it("uses the default registry when nothing is configured and strips a trailing slash", async () => {
    const { calls, result } = latest({}, goodRoutes("https://registry.npmjs.org"));
    await expect(result).resolves.toBe("1.2.3");
    expect(calls[0]).toBe("GET https://registry.npmjs.org/@pablopunk%2ftau");
    const slash = latest({ registry: `${REG}///` }, goodRoutes());
    await expect(slash.result).resolves.toBe("1.2.3");
    expect(slash.calls.every((call) => !call.includes("//@"))).toBe(true);
  });

  it("asks npm next to node with an args array", async () => {
    const seen: unknown[][] = [];
    const run: RunCommand = async (command, args, options) => {
      seen.push([command, args, options]);
      return { code: 0, stdout: `${REG}\n`, stderr: "" };
    };
    await fetchLatestVersion(run, "/n/bin/node", fakeFetch(goodRoutes()).impl);
    expect(seen[0]).toEqual([
      NPM,
      ["config", "get", "@pablopunk:registry"],
      { stdio: "capture", timeoutMs: 15000 },
    ]);
  });

  it.each([
    ["the version document is 404", { [`GET ${REG}/@pablopunk%2ftau/1.2.3`]: { status: 404 } }],
    ["the tarball is 404", { [`HEAD ${REG}/tau-1.2.3.tgz`]: { status: 404 } }],
    ["auth is required (401)", { [`GET ${REG}/@pablopunk%2ftau/1.2.3`]: { status: 401 } }],
    ["a proxy answers 407", { [`HEAD ${REG}/tau-1.2.3.tgz`]: { status: 407 } }],
    ["the request times out", { [`GET ${REG}/@pablopunk%2ftau`]: new Error("The operation timed out") }],
    [
      "the tag is not plain",
      { [`GET ${REG}/@pablopunk%2ftau`]: { status: 200, body: { "dist-tags": { latest: "2.0.0-beta.1" } } } },
    ],
    ["the packument is not JSON", { [`GET ${REG}/@pablopunk%2ftau`]: { status: 200, body: undefined } }],
  ] as const)("throws when %s, so the caller keeps its previous value", async (_name, override) => {
    const { result } = latest({ registry: REG }, { ...goodRoutes(), ...override } as Routes);
    await expect(result).rejects.toThrow(/npm registry|unexpected/);
  });

  it("a caller that keeps its last good value survives a failing check", async () => {
    let known = "1.0.0";
    const check = async (routes: Routes) => {
      try {
        known = await latest({ registry: REG }, routes).result;
      } catch {
        // previous value stays, like update-service does
      }
    };
    await check(goodRoutes());
    expect(known).toBe("1.2.3");
    await check({ ...goodRoutes(), [`HEAD ${REG}/tau-1.2.3.tgz`]: { status: 404 } });
    expect(known).toBe("1.2.3");
  });
});
