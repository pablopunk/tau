import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { readRunningInstance } from "@tau/core";
import { callRoute, discoverServer } from "../commands/client";
import { processEnv } from "../commands/command-env";
import { realLifecycleDeps } from "../lifecycle/deps";
import { ancestorPidsOf } from "./ancestors";
import { spawnCommand } from "./command-runner";
import { fetchLatestVersion } from "./latest-version";
import { fetchLinkedNodes } from "./nodes-behind";
import type { UpdateDeps } from "./update-deps";

const POLL_MS = 500;
const POLL_DEADLINE_MS = 60_000;

async function pollForVersion(home: string, version: string) {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  for (;;) {
    const instance = await readRunningInstance(home);
    if (instance?.version === version || Date.now() >= deadline) return instance;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

export async function realUpdateDeps(): Promise<UpdateDeps> {
  const base = await realLifecycleDeps();
  const entry = process.argv[1] === undefined ? "" : realpathSync(process.argv[1]);
  return {
    ...base,
    err: (message) => console.error(message),
    runCommand: spawnCommand,
    latestVersion: () => fetchLatestVersion(spawnCommand, process.execPath),
    listConversations: async (home) => {
      const env = { ...processEnv(), home };
      const server = await discoverServer(env);
      return (await callRoute(server, "listAllConversations", {}, env)) as Awaited<
        ReturnType<UpdateDeps["listConversations"]>
      >;
    },
    confirm: ask,
    isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    env: process.env,
    execPath: process.execPath,
    entry,
    realpath: realpathSync,
    readPackageVersion: (dir) => {
      try {
        return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string }).version;
      } catch {
        return undefined;
      }
    },
    ancestorPids: process.platform === "win32" ? undefined : () => ancestorPidsOf(spawnCommand),
    pollInstance: pollForVersion,
    hasHubFile: (home) => existsSync(join(home, "hub.json")),
    linkedNodes: fetchLinkedNodes,
  };
}
