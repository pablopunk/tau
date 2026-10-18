import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../../test-support/temp-dir";
import { runAuthStatus } from "../auth-status";
import type { ClaudeCliClock } from "../clock";
import type { ClaudeAuthStatus, ClaudeSdkPort } from "../sdk-types";
import { createFakeClaudeSdk, FAKE_LOGGED_IN } from "../testing/fake-claude-sdk";
import { createClaudeCliDetector } from "./claude-cli-detector";
import { parseCliVersion } from "./claude-cli-version";

const tempDir = useTempDir();

const LOGGED_IN_JSON = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  subscriptionType: "team",
  orgName: "Maze",
  email: "me@example.com",
  orgId: "org-secret",
});

async function fixtureCli(body: string): Promise<string> {
  const path = join(await tempDir(), "claude");
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

function manualClock() {
  const timers: { run: () => void; cancelled: boolean }[] = [];
  const retire = (timer: { cancelled: boolean }) => {
    timer.cancelled = true;
  };
  const clock: ClaudeCliClock = {
    now: () => 1_000,
    setTimer(run) {
      const timer = { run, cancelled: false };
      timers.push(timer);
      return () => retire(timer);
    },
  };
  const fire = () => {
    for (const timer of timers.filter((candidate) => !candidate.cancelled)) {
      retire(timer);
      timer.run();
    }
  };
  return { clock, fire, pending: () => timers.filter((timer) => !timer.cancelled).length };
}

function detectorFor(options: {
  auth: () => Promise<ClaudeAuthStatus>;
  noticeAt?: number | null;
  version?: string | null;
}) {
  const fake = createFakeClaudeSdk();
  const port: ClaudeSdkPort = { ...fake.port, authStatus: options.auth };
  const timers = manualClock();
  const counter = { changes: 0, noticeAt: options.noticeAt === undefined ? 1 : options.noticeAt };
  const detector = createClaudeCliDetector({
    sdk: async () => port,
    noticeAt: async () => counter.noticeAt,
    usage: () => null,
    onChange: () => {
      counter.changes += 1;
    },
    clock: timers.clock,
    installedVersion: async () => (options.version === undefined ? "2.1.300" : options.version),
  });
  return {
    detector,
    timers,
    changes: () => counter.changes,
    noticeAt: (value: number | null) => {
      counter.noticeAt = value;
    },
  };
}

const answering = (auth: ClaudeAuthStatus) => async () => auth;

describe("detection states from the auth status", () => {
  it("is ready for a claude.ai login with the notice accepted", async () => {
    const { detector } = detectorFor({ auth: answering(FAKE_LOGGED_IN) });
    expect(await detector.refresh()).toMatchObject({
      state: "ready",
      plan: "team",
      org: "Fake Org",
      cliVersion: "2.1.300",
      sdkCliVersion: "0.0.0-fake",
      message: null,
    });
  });

  it("needs the notice before it is ready", async () => {
    const { detector, noticeAt } = detectorFor({ auth: answering(FAKE_LOGGED_IN), noticeAt: null });
    expect((await detector.refresh()).state).toBe("needs_notice");
    noticeAt(5);
    expect((await detector.refresh()).state).toBe("ready");
  });

  it("is logged_out when the CLI says so", async () => {
    const { detector } = detectorFor({ auth: answering({ ...FAKE_LOGGED_IN, loggedIn: false }) });
    expect((await detector.refresh()).state).toBe("logged_out");
  });

  it("is not_plan for a console API login", async () => {
    const { detector } = detectorFor({ auth: answering({ ...FAKE_LOGGED_IN, authMethod: "console" }) });
    expect((await detector.refresh()).state).toBe("not_plan");
  });

  it("is missing when the binary does not exist", async () => {
    const env = { TAU_CLAUDE_PATH: "/definitely/not/claude" };
    const { detector } = detectorFor({ auth: () => runAuthStatus(env) });
    expect((await detector.refresh()).state).toBe("missing");
  });
});

describe("detection through fixture scripts", () => {
  it("reads a logged in CLI", async () => {
    const path = await fixtureCli(`echo '${LOGGED_IN_JSON}'`);
    const { detector } = detectorFor({ auth: () => runAuthStatus({ TAU_CLAUDE_PATH: path }) });
    expect(await detector.refresh()).toMatchObject({ state: "ready", plan: "team", org: "Maze" });
  });

  it("keeps no email and no org id", async () => {
    const path = await fixtureCli(`echo '${LOGGED_IN_JSON}'`);
    const { detector } = detectorFor({ auth: () => runAuthStatus({ TAU_CLAUDE_PATH: path }) });
    const serialized = JSON.stringify(await detector.refresh());
    expect(serialized).not.toContain("me@example.com");
    expect(serialized).not.toContain("org-secret");
  });

  it("reads a logged out CLI that exits 1", async () => {
    const path = await fixtureCli(`echo '{"loggedIn": false}'\nexit 1`);
    const { detector } = detectorFor({ auth: () => runAuthStatus({ TAU_CLAUDE_PATH: path }) });
    expect((await detector.refresh()).state).toBe("logged_out");
  });

  it("reads an API key login as not_plan", async () => {
    const path = await fixtureCli(`echo '{"loggedIn": true, "authMethod": "console"}'`);
    const { detector } = detectorFor({ auth: () => runAuthStatus({ TAU_CLAUDE_PATH: path }) });
    expect((await detector.refresh()).state).toBe("not_plan");
  });

  it("keeps the last state and sets a message on malformed JSON", async () => {
    const good = await fixtureCli(`echo '${LOGGED_IN_JSON}'`);
    const bad = await fixtureCli("echo 'not json'");
    let path = good;
    const { detector } = detectorFor({ auth: () => runAuthStatus({ TAU_CLAUDE_PATH: path }) });
    await detector.refresh();
    path = bad;
    const stale = await detector.refresh();
    expect(stale.state).toBe("ready");
    expect(stale.message).toContain("Could not check");
  });

  it("keeps the last state and sets a message when the CLI hangs past 5 s", async () => {
    const good = await fixtureCli(`echo '${LOGGED_IN_JSON}'`);
    const slow = await fixtureCli("exec sleep 10");
    let path = good;
    const { detector } = detectorFor({ auth: () => runAuthStatus({ TAU_CLAUDE_PATH: path }) });
    await detector.refresh();
    path = slow;
    const stale = await detector.refresh();
    expect(stale.state).toBe("ready");
    expect(stale.message).not.toBeNull();
  }, 15_000);
});

describe("detector refresh behaviour", () => {
  it("clears the message after a definite answer", async () => {
    let fail = false;
    const { detector } = detectorFor({
      auth: async () => {
        if (fail) throw new Error("boom");
        return FAKE_LOGGED_IN;
      },
    });
    await detector.refresh();
    fail = true;
    expect((await detector.refresh()).message).toContain("boom");
    fail = false;
    expect((await detector.refresh()).message).toBeNull();
  });

  it("reports the last status at once while a check runs", async () => {
    const gate = { release: (): void => undefined, slow: false };
    const { detector } = detectorFor({
      auth: async () => {
        if (gate.slow)
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
        return FAKE_LOGGED_IN;
      },
    });
    await detector.refresh();
    gate.slow = true;
    const pending = detector.refresh();
    expect(detector.status().state).toBe("ready");
    await new Promise((resolve) => setTimeout(resolve, 10));
    gate.release();
    await pending;
  });

  it("announces a change only when the status moved", async () => {
    const { detector, changes } = detectorFor({ auth: answering(FAKE_LOGGED_IN) });
    await detector.refresh();
    const afterFirst = changes();
    await detector.refresh();
    expect(afterFirst).toBe(1);
    expect(changes()).toBe(1);
  });

  it("checks again every 60 s until stopped", async () => {
    let calls = 0;
    const { detector, timers } = detectorFor({
      auth: async () => {
        calls += 1;
        return FAKE_LOGGED_IN;
      },
    });
    detector.start();
    await detector.refresh();
    const afterStart = calls;
    timers.fire();
    await detector.refresh();
    expect(calls).toBeGreaterThan(afterStart);
    detector.stop();
    expect(timers.pending()).toBe(0);
  });
});

describe("claude --version", () => {
  it("takes the version number out of the output", () => {
    expect(parseCliVersion("2.1.302 (Claude Code)\n")).toBe("2.1.302");
    expect(parseCliVersion("nothing")).toBeNull();
  });
});
