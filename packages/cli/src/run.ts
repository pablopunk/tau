import type { Core, CreateCore } from "@pi-everywhere/protocol";
import type { CreateServer } from "@pi-everywhere/server";
import { listenOnFreePort } from "./listen-on-free-port";
import type { CliOptions } from "./options";
import { ensurePrivateDirectory } from "./private-files";
import { findRunningInstance, forgetRunningInstance, recordRunningInstance } from "./running-instance";
import { readOrCreateToken } from "./token";

export interface RunDependencies {
  readonly createCore: CreateCore;
  readonly createServer: CreateServer;
  readonly openBrowser: (url: string) => Promise<void>;
  readonly log: (message: string) => void;
  readonly staticDir: string | undefined;
  readonly isProcessAlive?: (pid: number) => boolean;
}

export interface RunningApp {
  readonly url: string;
  close(): Promise<void>;
}

const urlFor = (port: number, token: string) =>
  `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;

async function reportExistingInstance(options: CliOptions, dependencies: RunDependencies, token: string) {
  const running = await findRunningInstance(options.home, dependencies.isProcessAlive);
  if (!running) return undefined;
  const url = urlFor(running.port, token);
  dependencies.log(`pi-everywhere is already running: ${url}`);
  return url;
}

async function openBrowserSafely(url: string, { openBrowser, log }: RunDependencies) {
  try {
    await openBrowser(url);
  } catch (error) {
    log(
      `Could not open the browser (${error instanceof Error ? error.message : error}). Open the URL above.`,
    );
  }
}

/** Resolves to the running app, or `undefined` when another instance already serves this home. */
export async function run(
  options: CliOptions,
  dependencies: RunDependencies,
): Promise<RunningApp | undefined> {
  await ensurePrivateDirectory(options.home);
  const token = await readOrCreateToken(options.home);
  if (await reportExistingInstance(options, dependencies, token)) return undefined;

  const core: Core = await dependencies.createCore({ home: options.home, faux: options.faux });
  try {
    const server = await listenOnFreePort(options.port, (port) =>
      dependencies.createServer({ core, port, token, staticDir: dependencies.staticDir }),
    );
    await recordRunningInstance(options.home, { pid: process.pid, port: server.port });
    dependencies.log(`pi-everywhere is running: ${server.url}`);
    if (options.open) await openBrowserSafely(server.url, dependencies);
    return {
      url: server.url,
      close: async () => {
        await forgetRunningInstance(options.home);
        await server.close();
        await core.close();
      },
    };
  } catch (error) {
    await core.close();
    throw error;
  }
}
