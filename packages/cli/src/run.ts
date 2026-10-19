import {
  createFilePeersStore,
  createTunnelTargetRef,
  peersFilePath,
  publishServerUrl,
  readRunningInstance,
} from "@tau/core";
import type { Core, CreateCore } from "@tau/protocol";
import type { CreateServer } from "@tau/server";
import { listenOnFreePort } from "./listen-on-free-port";
import type { StartLinkClient } from "./nodes/link-client";
import type { CliOptions } from "./options";
import { ensurePrivateDirectory } from "./private-files";
import { readOrCreateToken } from "./token";
import { latestVersionSource } from "./update/latest-source";

export interface RunDependencies {
  readonly createCore: CreateCore;
  readonly createServer: CreateServer;
  readonly openBrowser: (url: string) => Promise<void>;
  readonly log: (message: string) => void;
  readonly staticDir: string | undefined;
  /** The CLI entry file, for core's `<home>/bin/tau` shim. */
  readonly cliEntry?: string;
  /** Dials every peer of `<home>/peers.json`; absent in tests. */
  readonly startLinkClient?: StartLinkClient;
  /** Written to the lock file. */
  readonly version?: string;
  /** The registry's latest version for core's update status. Default: npm, or `TAU_FAKE_LATEST`. */
  readonly latestVersion?: () => Promise<string>;
}

export interface RunningApp {
  readonly url: string;
  close(): Promise<void>;
}

const withToken = (origin: string, token: string) => `${origin}/?token=${encodeURIComponent(token)}`;

async function reportExistingInstance(options: CliOptions, dependencies: RunDependencies, token: string) {
  const running = await readRunningInstance(options.home);
  if (!running?.url) return undefined;
  const url = withToken(running.url, token);
  dependencies.log(`tau is already running: ${url}`);
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

  const tunnelTarget = createTunnelTargetRef();
  const core: Core = await dependencies.createCore({
    home: options.home,
    faux: options.faux,
    cliEntry: dependencies.cliEntry,
    tunnelTarget: tunnelTarget.get,
    currentVersion: dependencies.version ?? "",
    latestVersion: dependencies.latestVersion ?? latestVersionSource(),
  });
  try {
    const server = await listenOnFreePort(options.port, (port) =>
      dependencies.createServer({ core, port, token, staticDir: dependencies.staticDir }),
    );
    tunnelTarget.set(server.tunnelPort);
    await publishServerUrl(options.home, server.origin, dependencies.version);
    dependencies.log(`tau is running: ${server.url}`);
    if (options.open) await openBrowserSafely(server.url, dependencies);
    const link = dependencies.startLinkClient?.({
      core,
      attachPeer: server.attachPeer,
      peers: createFilePeersStore(peersFilePath(options.home)),
    });
    return {
      url: server.url,
      close: async () => {
        await link?.stop();
        await server.close();
        await core.close();
      },
    };
  } catch (error) {
    await core.close();
    throw error;
  }
}
