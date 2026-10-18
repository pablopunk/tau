import { type LockInfo, readRunningInstance } from "@tau/core";
import { type CliEntry, cliEntry } from "../cli-entry";
import { realContext, type ServiceContext } from "../service/context";
import { createServiceManager, type ServiceManager } from "../service/manager";
import { readOrCreateToken } from "../token";
import { cliVersion } from "../version";

export interface LifecycleDeps {
  readonly context: ServiceContext;
  readonly cli: () => CliEntry;
  readonly version: () => string;
  readonly readInstance: (home: string) => Promise<LockInfo | undefined>;
  readonly waitForInstanceUrl: (home: string) => Promise<LockInfo | undefined>;
  readonly readToken: (home: string) => Promise<string>;
  readonly openBrowser: (url: string) => Promise<void>;
  readonly out: (message: string) => void;
  readonly fileExists: (path: string) => boolean;
}

export const withToken = (origin: string, token: string) => `${origin}/?token=${encodeURIComponent(token)}`;

export const managerOf = (deps: LifecycleDeps, home: string): ServiceManager =>
  createServiceManager(deps.context, deps.cli(), home);

export const NOT_RUNNING = "tau is not running. Run `tau` to start it.";

export async function realLifecycleDeps(): Promise<LifecycleDeps> {
  const { waitForUrl } = await import("./wait-for-lock");
  const { existsSync } = await import("node:fs");
  return {
    context: realContext(),
    cli: () => cliEntry(),
    version: cliVersion,
    readInstance: readRunningInstance,
    waitForInstanceUrl: (home) => waitForUrl(home),
    readToken: readOrCreateToken,
    openBrowser: async (url) => {
      const { default: open } = await import("open");
      await open(url);
    },
    out: (message) => console.log(message),
    fileExists: existsSync,
  };
}
