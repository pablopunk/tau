import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Core } from "@tau/protocol";
import { createServer, type RunningServer } from "@tau/server";
import { afterEach, describe, expect, it } from "vitest";
import { discoverServer } from "./client";
import { processEnv } from "./command-env";
import { executeApiCommand } from "./run-command";
import { summary, viewWith } from "./test-support";

const TOKEN = "k".repeat(40);

const stubCore = {
  settings: { get: async () => ({ projectsFolder: "/stub" }) },
  conversations: {
    listAll: async () => [summary("t1", { lastRunEndedAt: 3 })],
    watch: async (_id: string, forward: (ops: unknown[]) => Promise<void>) => {
      await forward([["r", viewWith("real answer")]]);
      return { stop: async () => undefined };
    },
  },
  onChange: () => () => undefined,
  close: async () => undefined,
} as unknown as Core;

let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(): Promise<{ home: string }> {
  server = await createServer({ core: stubCore, port: 0, token: TOKEN });
  const home = mkdtempSync(join(tmpdir(), "tau-live-"));
  writeFileSync(join(home, "token"), `${TOKEN}\n`);
  writeFileSync(join(home, "lock"), JSON.stringify({ pid: process.pid, url: server.origin }));
  return { home };
}

describe("with a real server", () => {
  it("calls REST with Bearer", async () => {
    const { home } = await start();
    const out: string[] = [];
    await executeApiCommand("settings", ["get"], {
      ...processEnv(),
      home,
      env: {},
      stdout: (text) => out.push(text),
    });
    expect(JSON.parse(out[0] as string)).toEqual({ projectsFolder: "/stub" });
  });

  it("reads and waits over the WebSocket with Bearer", async () => {
    const { home } = await start();
    const out: string[] = [];
    const env = { ...processEnv(), home, env: {}, stdout: (text: string) => out.push(text) };
    await executeApiCommand("threads", ["read", "t1"], env);
    await executeApiCommand("threads", ["wait", "t1"], env);
    expect(out).toEqual(["user: go\n\nassistant: real answer", "real answer"]);
  });

  it("is refused with a wrong token", async () => {
    const { home } = await start();
    writeFileSync(join(home, "token"), `${"x".repeat(40)}\n`);
    const env = { ...processEnv(), home, env: {} };
    await expect(discoverServer(env).then(() => executeApiCommand("settings", ["get"], env))).rejects.toThrow(
      /unauthorized|401/,
    );
  });
});
