import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliExit } from "./cli-exit";
import { callRoute, discoverServer } from "./client";
import { FakeTau, makeHome, TEST_TOKEN, TEST_URL } from "./test-support";

describe("discoverServer", () => {
  it("reads the URL from the lock and the token from the home", async () => {
    const env = new FakeTau().env(makeHome());
    expect(await discoverServer(env)).toEqual({ url: TEST_URL, token: TEST_TOKEN });
  });

  it("retries while a live server has not published its URL, then succeeds", async () => {
    const home = makeHome(null);
    let sleeps = 0;
    const env = new FakeTau().env(home, {
      sleep: async () => {
        sleeps++;
        if (sleeps === 3)
          writeFileSync(join(home, "lock"), JSON.stringify({ pid: process.pid, url: TEST_URL }));
      },
    });
    expect((await discoverServer(env)).url).toBe(TEST_URL);
    expect(sleeps).toBe(3);
  });

  it("gives up after the startup wait", async () => {
    let clock = 0;
    const env = new FakeTau().env(makeHome(null), {
      now: () => clock,
      sleep: async () => {
        clock += 1000;
      },
    });
    await expect(discoverServer(env)).rejects.toThrow(/has not published its URL/);
  });

  it("says tau is not running with no lock, exit 1", async () => {
    const empty = mkdtempSync(join(tmpdir(), "tau-none-"));
    const error = await discoverServer(new FakeTau().env(empty)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliExit);
    expect((error as CliExit).message).toBe("tau is not running. Run `tau` to start it.");
    expect((error as CliExit).exitCode).toBe(1);
  });
});

describe("callRoute", () => {
  it("sends Bearer and prints errors as code: message", async () => {
    const fake = new FakeTau();
    fake.answers.set("GET /api/settings", {
      status: 404,
      body: { error: { code: "not_found", message: "nope" } },
    });
    const env = fake.env(makeHome());
    await expect(callRoute({ url: TEST_URL, token: TEST_TOKEN }, "getSettings", {}, env)).rejects.toThrow(
      "not_found: nope",
    );
    expect(fake.calls[0]?.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
  });

  it("reports a refused connection as not running", async () => {
    const env = { ...new FakeTau().env(makeHome()), fetch: () => Promise.reject(new Error("ECONNREFUSED")) };
    await expect(callRoute({ url: TEST_URL, token: TEST_TOKEN }, "getSettings", {}, env)).rejects.toThrow(
      /not running/,
    );
  });
});
