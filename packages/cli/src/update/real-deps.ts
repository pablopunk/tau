import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { callRoute, discoverServer } from "../commands/client";
import { processEnv } from "../commands/command-env";
import { realLifecycleDeps } from "../lifecycle/deps";
import { ancestorPidsOf } from "./ancestors";
import { spawnCommand } from "./command-runner";
import { releasesApiOf } from "./fake-hooks";
import { installRootOfThisTau } from "./install-root";
import { fetchRelease, RELEASES_API } from "./latest-version";
import { latestVersionSource } from "./latest-source";
import { releasePlatformOf } from "./platform";
import { fetchLinkedNodes } from "./nodes-behind";
import type { UpdateDeps } from "./update-deps";

const POLL_MS = 500;

async function currentVersionReported(home: string): Promise<string | undefined> {
  try {
    const env = { ...processEnv(), home };
    const status = (await callRoute(await discoverServer(env), "getUpdateStatus", {}, env)) as { current?: string };
    return status.current;
  } catch {
    return undefined;
  }
}

async function pollRunningVersion(home: string, version: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let last: string | undefined;
  for (;;) {
    last = (await currentVersionReported(home)) ?? last;
    if (last === version || Date.now() >= deadline) return last;
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
  return {
    ...base,
    err: (message) => console.error(message),
    runCommand: spawnCommand,
    latestVersion: () => latestVersionSource(process.env, process.env.TAU_HOME)(),
    installRoot: installRootOfThisTau(),
    platformKey: releasePlatformOf(),
    fetch,
    findRelease: (version, home) =>
      fetchRelease(fetch, releasePlatformOf(), `v${version}`, releasesApiOf(home, RELEASES_API)),
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
    ancestorPids: process.platform === "win32" ? undefined : () => ancestorPidsOf(spawnCommand),
    pollRunningVersion,
    hasHubFile: (home) => existsSync(join(home, "peers.json")) || existsSync(join(home, "hub.json")),
    linkedNodes: fetchLinkedNodes,
  };
}
