import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stageRelease } from "./install-release";
import type { Release } from "./latest-version";

const release: Release = {
  version: "9.9.9",
  archiveName: "tau.tar.gz",
  archiveUrl: "https://x/tau.tar.gz",
  sumsUrl: "https://x/SHA256SUMS",
};

function setup(respond: (url: string, call: number) => Response) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const deps = {
    fetch: (async (url: string) => {
      calls.push(url);
      return respond(url, calls.length);
    }) as never,
    run: (async () => ({ code: 1, stdout: "", stderr: "stop" })) as never,
    sleep: async (ms: number) => void sleeps.push(ms),
  };
  return { deps, calls, sleeps };
}

const root = () => mkdtemp(join(tmpdir(), "tau-retry-"));
const names = async (dir: string) => (await readdir(dir)).filter((n) => n !== "versions");

describe("download retries", () => {
  it("retries a network error twice, then succeeds", async () => {
    const { deps, calls, sleeps } = setup((url, call) => {
      if (url.endsWith(".gz")) {
        if (call <= 2) throw new TypeError("socket closed");
        return new Response("data");
      }
      return new Response(`${"0".repeat(64)}  tau.tar.gz\n`);
    });
    const dir = await root();
    await expect(stageRelease(deps, release, dir)).rejects.toThrow(/does not match SHA256SUMS/);
    expect(calls.filter((u) => u.endsWith(".gz"))).toHaveLength(3);
    expect(sleeps).toEqual([2000, 5000]);
    expect(await names(dir)).toEqual([]);
  });

  it("gives the same error after three failed attempts", async () => {
    const { deps, calls } = setup(() => {
      throw new TypeError("socket closed");
    });
    await expect(stageRelease(deps, release, await root())).rejects.toThrow("socket closed");
    expect(calls).toHaveLength(3);
  });

  it("retries 5xx", async () => {
    const { deps, calls } = setup(() => new Response("no", { status: 503 }));
    await expect(stageRelease(deps, release, await root())).rejects.toThrow(/HTTP 503/);
    expect(calls).toHaveLength(3);
  });

  it("does not retry a 404", async () => {
    const { deps, calls, sleeps } = setup(() => new Response("no", { status: 404 }));
    await expect(stageRelease(deps, release, await root())).rejects.toThrow(/HTTP 404/);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});
