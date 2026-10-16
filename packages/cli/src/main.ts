import { createCore } from "@pi-everywhere/core";
import { createServer } from "@pi-everywhere/server";
import { parseCliOptions } from "./options";
import { run } from "./run";
import { findStaticDir } from "./static-dir";

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

export async function main(argv: readonly string[]): Promise<void> {
  const app = await run(parseCliOptions(argv), {
    createCore,
    createServer,
    openBrowser,
    log: (message) => console.log(message),
    staticDir: findStaticDir(),
  });
  if (app) closeOnSignals(app.close);
}
