import { AppError, type Core, type ProjectIconImage } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];

function pngBytes(size: number, extraBytes = 0): Buffer {
  const bytes = Buffer.alloc(33 + extraBytes);
  Buffer.from(PNG_HEADER).copy(bytes);
  bytes.writeUInt32BE(size, 16);
  bytes.writeUInt32BE(size, 20);
  return bytes;
}

const putIcon = (url: string, png: string) => ctx.request({ method: "PUT", url, payload: { png } });

async function addProject(): Promise<string> {
  const response = await ctx.request({
    method: "POST",
    url: "/api/projects",
    payload: { path: "/Users/demo/project" },
  });
  return response.json().id;
}

function coreWith(overrides: (core: Core) => Partial<Core>): Core {
  const core = createFakeCore({ configured: true, speed: 1000 });
  return { ...core, ...overrides(core) };
}

const svgImage: ProjectIconImage = {
  contentType: "image/svg+xml",
  data: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
};

describe("github routes", () => {
  it.each([
    [{ state: "not_installed" }],
    [{ state: "not_logged_in", hint: "gh auth login" }],
    [{ state: "error", message: "offline" }],
  ] as const)("answers status %j with 200", async (status) => {
    ctx = await startTestServer({ fake: { github: { status } } });
    const response = await ctx.request({ url: "/api/github/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(status);
  });

  it("answers github_unavailable 409 for repos, refresh and use", async () => {
    ctx = await startTestServer({ fake: { github: { status: { state: "not_installed" } } } });
    const calls = [
      { url: "/api/github/repos" },
      { method: "POST" as const, url: "/api/github/repos/refresh" },
      {
        method: "POST" as const,
        url: "/api/github/use",
        payload: { nameWithOwner: "demo/dotfiles", mode: "clone" },
      },
    ];
    for (const call of calls) {
      const response = await ctx.request(call);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("github_unavailable");
    }
  });

  it("answers not_found 404 for an unknown repository", async () => {
    ctx = await startTestServer();
    const response = await ctx.request({
      method: "POST",
      url: "/api/github/use",
      payload: { nameWithOwner: "demo/nope", mode: "clone" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });

  it("answers needs_folder 409 when local mode has no copy", async () => {
    ctx = await startTestServer();
    const response = await ctx.request({
      method: "POST",
      url: "/api/github/use",
      payload: { nameWithOwner: "demo/api-server", mode: "local" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("needs_folder");
  });

  it("answers remote_mismatch 422", async () => {
    const core = coreWith(() => ({
      github: {
        ...createFakeCore().github,
        use: vi.fn().mockRejectedValue(new AppError("remote_mismatch", "Wrong remote.")),
      },
    }));
    ctx = await startTestServer({ core });
    const response = await ctx.request({
      method: "POST",
      url: "/api/github/use",
      payload: { nameWithOwner: "demo/tau", mode: "folder", path: "/Users/demo/src" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("remote_mismatch");
  });

  it("answers 400 for an invalid use body", async () => {
    ctx = await startTestServer();
    const bad = [
      { nameWithOwner: "no-slash", mode: "clone" },
      { nameWithOwner: "demo/dotfiles", mode: "teleport" },
      { mode: "clone" },
    ];
    for (const payload of bad) {
      const response = await ctx.request({ method: "POST", url: "/api/github/use", payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("invalid_request");
    }
  });

  it("answers the repo list sorted with a project link after use", async () => {
    ctx = await startTestServer();
    const used = await ctx.request({
      method: "POST",
      url: "/api/github/use",
      payload: { nameWithOwner: "demo/dotfiles", mode: "clone" },
    });
    expect(used.statusCode).toBe(201);
    const repos = (await ctx.request({ url: "/api/github/repos" })).json();
    expect(repos.map((repo: { nameWithOwner: string }) => repo.nameWithOwner)[0]).toBe("demo/tau");
    expect(
      repos.find((repo: { nameWithOwner: string }) => repo.nameWithOwner === "demo/dotfiles").projectId,
    ).toBe(used.json().id);
  });
});

describe("icon PUT", () => {
  it("rejects a non-png, a wrong size, an empty body and a bad base64 payload with 400", async () => {
    ctx = await startTestServer();
    const url = `/api/projects/${await addProject()}/icon`;
    for (const png of [Buffer.alloc(40).toString("base64"), pngBytes(64).toString("base64"), "", "!!!"]) {
      const response = await putIcon(url, png);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("invalid_request");
    }
  });

  it("rejects a png above 256 KB with 400 and a body above 1 MB with 413", async () => {
    ctx = await startTestServer();
    const url = `/api/projects/${await addProject()}/icon`;
    const big = await putIcon(url, pngBytes(128, 300 * 1024).toString("base64"));
    expect(big.statusCode).toBe(400);
    const huge = await putIcon(url, pngBytes(128, 2 * 1024 * 1024).toString("base64"));
    expect(huge.statusCode).toBe(413);
    expect(huge.json().error.code).toBe("too_large");
  });

  it("accepts a 128px png just under 256 KB", async () => {
    ctx = await startTestServer();
    const url = `/api/projects/${await addProject()}/icon`;
    expect((await putIcon(url, pngBytes(128, 200 * 1024).toString("base64"))).statusCode).toBe(204);
  });

  it("answers 400 for Home and 404 for an unknown project", async () => {
    ctx = await startTestServer();
    const png = pngBytes(128).toString("base64");
    expect((await putIcon("/api/projects/home/icon", png)).statusCode).toBe(400);
    expect((await putIcon("/api/projects/nope/icon", png)).statusCode).toBe(404);
    expect((await ctx.request({ method: "DELETE", url: "/api/projects/nope/icon" })).statusCode).toBe(404);
  });

  it("answers 400 for a body without png", async () => {
    ctx = await startTestServer();
    const url = `/api/projects/${await addProject()}/icon`;
    const response = await ctx.request({ method: "PUT", url, payload: { other: 1 } });
    expect(response.statusCode).toBe(400);
  });
});

describe("icon GET headers", () => {
  it("answers 404 not_found for Home, unknown projects and projects without an icon", async () => {
    ctx = await startTestServer();
    const id = await addProject();
    for (const url of [`/api/projects/${id}/icon`, "/api/projects/home/icon"]) {
      const response = await ctx.request({ url });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("not_found");
    }
    expect((await ctx.request({ url: "/api/projects/nope/icon" })).statusCode).toBe(404);
  });

  it("sets nosniff, no-cache and an ETag, and answers 304 for strong, weak and listed tags", async () => {
    ctx = await startTestServer();
    const id = await addProject();
    const url = `/api/projects/${id}/icon`;
    await putIcon(url, pngBytes(128).toString("base64"));
    const first = await ctx.request({ url });
    const etag = String(first.headers.etag);
    expect(first.headers["cache-control"]).toBe("no-cache");
    expect(first.headers["x-content-type-options"]).toBe("nosniff");
    expect(first.headers["content-security-policy"]).toBeUndefined();
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const cached = await ctx.request({ url, headers: { "if-none-match": header } });
      expect(cached.statusCode).toBe(304);
      expect(cached.headers["x-content-type-options"]).toBe("nosniff");
    }
    const stale = await ctx.request({ url, headers: { "if-none-match": '"stale"' } });
    expect(stale.statusCode).toBe(200);
  });

  it("sandboxes an SVG icon", async () => {
    const core = coreWith(() => ({}));
    const projects = { ...core.projects, icon: async () => svgImage };
    ctx = await startTestServer({ core: { ...core, projects } });
    const response = await ctx.request({ url: "/api/projects/home/icon" });
    expect(response.headers["content-type"]).toBe("image/svg+xml");
    expect(response.headers["content-security-policy"]).toBe("sandbox");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("icon candidates", () => {
  it("lists candidates with urls and serves a candidate with image headers", async () => {
    const core = coreWith(() => ({}));
    const projects = {
      ...core.projects,
      iconCandidates: async () => [{ name: "public/favicon.svg" }],
      iconCandidate: async (_id: string, name: string) => (name === "public/favicon.svg" ? svgImage : null),
    } as unknown as Core["projects"];
    ctx = await startTestServer({ core: { ...core, projects } });
    const id = await addProject();
    const list = (await ctx.request({ url: `/api/projects/${id}/icon-candidates` })).json();
    expect(list).toEqual([
      {
        name: "public/favicon.svg",
        url: `/api/projects/${id}/icon-candidates/file?name=public%2Ffavicon.svg`,
      },
    ]);
    const file = await ctx.request({ url: list[0].url });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-security-policy"]).toBe("sandbox");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["cache-control"]).toBe("no-cache");
  });

  it.each([
    "../secret.png",
    "public/../../secret.png",
    "%2e%2e%2fsecret.png",
    "/etc/passwd",
    "public%5C..%5Csecret.png",
    "public//a.png",
    "a%00.png",
    "public/",
  ])("rejects name %s with 400 before core", async (name) => {
    const iconCandidate = vi.fn();
    const core = coreWith(() => ({}));
    ctx = await startTestServer({ core: { ...core, projects: { ...core.projects, iconCandidate } } });
    const id = await addProject();
    const response = await ctx.request({ url: `/api/projects/${id}/icon-candidates/file?name=${name}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect(iconCandidate).not.toHaveBeenCalled();
  });

  it("rejects a missing and an empty name with 400", async () => {
    ctx = await startTestServer();
    const id = await addProject();
    for (const query of ["", "?name="]) {
      const response = await ctx.request({ url: `/api/projects/${id}/icon-candidates/file${query}` });
      expect(response.statusCode).toBe(400);
    }
  });

  it("answers 404 for an unknown project and for an unlisted name", async () => {
    ctx = await startTestServer();
    expect((await ctx.request({ url: "/api/projects/nope/icon-candidates" })).statusCode).toBe(404);
    const missing = await ctx.request({ url: "/api/projects/nope/icon-candidates/file?name=a.png" });
    expect(missing.statusCode).toBe(404);
    const id = await addProject();
    const unlisted = await ctx.request({ url: `/api/projects/${id}/icon-candidates/file?name=a.png` });
    expect(unlisted.statusCode).toBe(404);
    expect(unlisted.json().error.code).toBe("not_found");
  });
});

describe("cookie requirement", () => {
  it("answers 401 on the image routes without the session cookie", async () => {
    ctx = await startTestServer();
    const id = await addProject();
    const urls = [`/api/projects/${id}/icon`, `/api/projects/${id}/icon-candidates/file?name=a.png`];
    for (const url of urls) {
      const response = await ctx.server.app.inject({
        url,
        headers: { host: ctx.headers.host as string, origin: ctx.headers.origin as string },
      });
      expect(response.statusCode).toBe(401);
    }
  });
});
