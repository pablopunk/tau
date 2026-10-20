import { describe, expect, it } from "vitest";
import { fetchLatestVersion, fetchRelease } from "./latest-version";

const PLATFORM = "darwin-arm64";
const API = "https://api.test/repos/pablopunk/tau";

const asset = (name: string) => ({ name, browser_download_url: `https://dl.test/${name}` });
const release = (assets: string[], extra: Record<string, unknown> = {}) => ({
  tag_name: "v1.2.3",
  assets: assets.map(asset),
  ...extra,
});
const COMPLETE = [`tau-1.2.3-${PLATFORM}.tar.gz`, "SHA256SUMS"];

function fakeFetch(answer: () => Response | Error) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: init?.headers as Record<string, string> });
    const result = answer();
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
  return { impl, seen };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("fetchRelease", () => {
  it("returns the latest release with this platform's archive and SHA256SUMS, sending a User-Agent", async () => {
    const f = fakeFetch(() => json(release(COMPLETE)));
    expect(await fetchRelease(f.impl, PLATFORM, "latest", API)).toEqual({
      version: "1.2.3",
      archiveName: `tau-1.2.3-${PLATFORM}.tar.gz`,
      archiveUrl: `https://dl.test/tau-1.2.3-${PLATFORM}.tar.gz`,
      sumsUrl: "https://dl.test/SHA256SUMS",
    });
    expect(f.seen[0]?.url).toBe(`${API}/releases/latest`);
    expect(f.seen[0]?.headers["user-agent"]).toBeTruthy();
  });

  it("asks for a tag when given one", async () => {
    const f = fakeFetch(() => json(release(COMPLETE)));
    await fetchRelease(f.impl, PLATFORM, "v1.2.3", API);
    expect(f.seen[0]?.url).toBe(`${API}/releases/tags/v1.2.3`);
  });

  it.each([
    ["404 (no release)", () => json({}, 404), "HTTP 404"],
    ["403 rate limit with retry-after", () => json({}, 403, { "retry-after": "3600" }), "retry after 3600s"],
    ["429", () => json({}, 429, { "retry-after": "60" }), "HTTP 429"],
    [
      "a partial release: no archive for this platform",
      () => json(release(["SHA256SUMS", "tau-1.2.3-linux-x64.tar.gz"])),
      "has no tau-1.2.3-darwin-arm64.tar.gz",
    ],
    ["a partial release: no SHA256SUMS", () => json(release([COMPLETE[0] as string])), "has no SHA256SUMS"],
    ["a draft", () => json(release(COMPLETE, { draft: true })), "not published"],
    [
      "a timeout",
      () => Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }),
      "timed out",
    ],
    [
      "a TLS error",
      () => new TypeError("fetch failed: unable to verify the first certificate"),
      "certificate",
    ],
    ["a body that is not JSON", () => new Response("<html>"), "not JSON"],
  ])("throws on %s", async (_name, answer, message) => {
    const f = fakeFetch(answer);
    await expect(fetchRelease(f.impl, PLATFORM, "latest", API)).rejects.toThrow(message);
  });

  it("throws on an unexpected tag", async () => {
    const f = fakeFetch(() => json({ ...release(COMPLETE), tag_name: "nightly" }));
    await expect(fetchRelease(f.impl, PLATFORM, "latest", API)).rejects.toThrow("unexpected version");
  });

  it("throws where tau ships no binary", async () => {
    const f = fakeFetch(() => json(release(COMPLETE)));
    await expect(fetchRelease(f.impl, undefined, "latest", API)).rejects.toThrow("no binary");
    expect(f.seen).toEqual([]);
  });

  it("fetchLatestVersion returns the plain version", async () => {
    const f = fakeFetch(() => json(release(COMPLETE)));
    expect(await fetchLatestVersion(PLATFORM, f.impl, API)).toBe("1.2.3");
  });
});
