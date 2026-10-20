import { join } from "node:path";
import { createCore, createExitMarker, startWatchdog, type Watchdog } from "@tau/core";
import { createServer } from "@tau/server";
import { cliEntry } from "./cli-entry";
import { lifecycleFlagsOf } from "./lifecycle/flags";
import { resolvePort, writeStoredPort } from "./lifecycle/port-store";
import { waitForFreeHome } from "./lifecycle/wait-for-lock";
import { mirrorConsoleToLogFile } from "./logging/file-logging";
import { startLinkClient } from "./nodes/link-client";
import { defaultHome, parseCliOptions } from "./options";
import { writePrivateFile } from "./private-files";
import { run } from "./run";
import { compiled, versionDir } from "./runtime/install-paths";
import { findStaticDir } from "./static-dir";
import { versionOf } from "./update/fake-hooks";
import { serverRecordOf } from "./update/install-layout";
import { cliVersion } from "./version";

async function openBrowser(url: string): Promise<void> {
  const { default: open } = await import("open");
  await open(url);
}

/** Only the service-managed run is watched: a hang is killed and the OS service restarts it. */
function startServiceWatchdog(home: string): Watchdog {
  return startWatchdog({
    lastExitFile: join(home, "last-exit.json"),
    logFile: join(home, "logs", "server.log"),
    workerUrl: new URL("./watchdog.js", import.meta.url),
  });
}

function closeOnSignals(close: () => Promise<void>, markExit: (reason: "signal") => void): void {
  let closing = false;
  const shutDown = () => {
    if (closing) return;
    closing = true;
    markExit("signal");
    close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", shutDown);
  process.on("SIGTERM", shutDown);
}

/** `<home>/server.json`: retention never deletes the folder this server runs from. */
async function writeServerRecord(home: string): Promise<void> {
  await writePrivateFile(
    serverRecordOf(home),
    JSON.stringify({ pid: process.pid, versionDir: versionDir() }),
  );
}

const portOfUrl = (url: string): number => Number(new URL(url).port);

async function serveOnce(argv: readonly string[]): Promise<void> {
  const parsed = parseCliOptions(argv);
  const { explicitPort } = lifecycleFlagsOf(argv, { defaultHome: defaultHome(), env: process.env });
  mirrorConsoleToLogFile(parsed.home);
  if (parsed.service) await waitForFreeHome(parsed.home, { log: (message) => console.log(message) });
  const options = { ...parsed, port: resolvePort(parsed.home, explicitPort) };
  const app = await run(options, {
    createCore,
    // `tau access rotate` swaps the master token live; the new one is written to `<home>/token` first.
    createServer: (serverOptions) =>
      createServer({
        ...serverOptions,
        onTokenRotated: (token) => writePrivateFile(join(options.home, "token"), `${token}\n`),
      }),
    openBrowser,
    startLinkClient,
    log: (message) => console.log(message),
    staticDir: findStaticDir(),
    cliCommand: cliEntry(),
    assets: compiled() ? { versionDir: versionDir() } : undefined,
    version: versionOf(cliVersion(), options.home),
  });
  if (!app) return options.service ? process.exit(1) : undefined;
  writeStoredPort(options.home, portOfUrl(app.url));
  if (compiled()) await writeServerRecord(options.home);
  const watchdog = options.service ? startServiceWatchdog(options.home) : undefined;
  const markExit = createExitMarker(join(options.home, "last-exit.json"));
  process.on("exit", (code) => code === 0 && markExit("clean"));
  closeOnSignals(async () => {
    await watchdog?.stop();
    await app.close();
  }, markExit);
}

/** `tau serve`: the server in the foreground. `argv` holds only the server flags. */
export async function serveInForeground(argv: readonly string[]): Promise<void> {
  try {
    await serveOnce(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
