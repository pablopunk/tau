import { createCore } from "@tau/core";
import { createServer } from "@tau/server";
import { cliEntry } from "./cli-entry";
import { parseCliOptions } from "./options";
import { run } from "./run";
import { findStaticDir } from "./static-dir";
import { cliVersion } from "./version";

async function openBrowser(url: string): Promise<void> {
  const { default: open } = await import("open");
  await open(url);
}

function closeOnSignals(close: () => Promise<void>): void {
  let closing = false;
  const shutDown = () => {
    if (closing) return;
    closing = true;
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

/** `tau serve`: the server in the foreground. `argv` holds only the server flags. */
export async function serveInForeground(argv: readonly string[]): Promise<void> {
  const options = parseCliOptions(argv);
  const app = await run(options, {
    createCore,
    createServer,
    openBrowser,
    log: (message) => console.log(message),
    staticDir: findStaticDir(),
    cliEntry: cliEntry().entry,
    version: cliVersion(),
  });
  if (app) closeOnSignals(app.close);
}
