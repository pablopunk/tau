import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceContext } from "./context";
import { createFakeRunner, type FakeRunner } from "./fake-runner";

export interface TestNode {
  readonly context: ServiceContext;
  readonly runner: FakeRunner;
  readonly osHome: string;
  readonly tauHome: string;
}

/** A fake node in a temp dir: nothing here touches the real OS or `~/.tau`. */
export function createTestNode(
  overrides: Partial<ServiceContext> = {},
  respond?: Parameters<typeof createFakeRunner>[0],
): TestNode {
  const root = mkdtempSync(join(tmpdir(), "tau-service-"));
  const osHome = join(root, "user");
  const runner = createFakeRunner(respond);
  const killed = new Set<number>();
  const context: ServiceContext = {
    platform: "darwin",
    uid: 501,
    username: "pablo",
    osHome,
    defaultHome: join(osHome, ".tau"),
    xdgRuntimeDir: "/run/user/501",
    windowsBuild: 19045,
    env: { PATH: "/usr/bin:/bin" },
    runner,
    isAlive: (pid) => pid === 4242 && !killed.has(pid),
    kill: (pid) => void killed.add(pid),
    sleep: async () => undefined,
    commandOf: async () => undefined,
    ...overrides,
  };
  return { context, runner, osHome, tauHome: context.defaultHome };
}

export const CLI = { node: "/opt/node/bin/node", entry: "/opt/tau/dist/bin.js" } as const;
