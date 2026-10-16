import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRunGh } from "../github/run-gh";
import { CONNECTED_AS_DEMO, type FakeGhConfig, installFakeGh } from "./fake-gh";
import { FAKE_GH_ARGV, GH_REPOS_ARGV, GH_STATUS_ARGV } from "./gh-argv";

const CONFIG: FakeGhConfig = {
  status: CONNECTED_AS_DEMO,
  repos: [
    {
      full_name: "demo/api",
      private: true,
      pushed_at: "2026-01-01T00:00:00Z",
      clone_url: "https://github.com/demo/api.git",
      ssh_url: "git@github.com:demo/api.git",
      description: null,
    },
  ],
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(config: FakeGhConfig = CONFIG) {
  const root = mkdtempSync(join(tmpdir(), "pie-fake-gh-"));
  roots.push(root);
  const installed = installFakeGh(root, config);
  const log = join(root, "log");
  const env = { ...process.env, FAKE_GH_CONFIG: installed.configFile, FAKE_GH_LOG: log };
  return { gh: join(installed.bin, "gh"), env, log };
}

describe("fake gh", () => {
  it("answers the status argv with the gh json shape", () => {
    const { gh, env } = setup();
    const out = JSON.parse(execFileSync(gh, [...GH_STATUS_ARGV], { env, encoding: "utf8" }));
    expect(out.hosts["github.com"][0]).toMatchObject({
      state: "success",
      login: "demo",
      gitProtocol: "https",
    });
  });

  it("answers the repos argv with the configured projection", () => {
    const { gh, env } = setup();
    const out = JSON.parse(execFileSync(gh, [...GH_REPOS_ARGV], { env, encoding: "utf8" }));
    expect(out).toEqual(CONFIG.repos);
  });

  it("answers a logged-out status with no hosts", () => {
    const { gh, env } = setup({ ...CONFIG, status: { state: "not_logged_in" } });
    expect(JSON.parse(execFileSync(gh, [...GH_STATUS_ARGV], { env, encoding: "utf8" }))).toEqual({
      hosts: {},
    });
  });

  it("rejects any other argv and logs every call", () => {
    const { gh, env, log } = setup();
    const result = spawnSync(gh, ["auth", "token"], { env, encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unexpected arguments");
    expect(readFileSync(log, "utf8").trim()).toBe(JSON.stringify(["auth", "token"]));
  });

  it("lists exactly two argv shapes", () => expect(FAKE_GH_ARGV).toHaveLength(2));

  it("is runnable through createRunGh", async () => {
    const { gh, env } = setup();
    const run = createRunGh(gh, env);
    const result = await run(GH_STATUS_ARGV);
    expect(result.exitCode).toBe(0);
    expect((await run(["nope"])).exitCode).toBe(2);
  });
});
