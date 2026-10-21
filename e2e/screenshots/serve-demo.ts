import { startDemoEnvironment } from "./environment";

/**
 * A persistent faux server for manual testing: same seeded demo as the
 * screenshots (fake provider, demo projects and threads), but it stays up.
 * Open the printed URL in a browser; narrowing the window shows the phone
 * layout. Quit with Ctrl-C.
 */
const environment = await startDemoEnvironment();
const login = `${environment.url}/?token=${encodeURIComponent(environment.token)}`;
console.log(`demo ready: ${login}`);

const shutdown = async () => {
  await environment.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
await new Promise(() => undefined);
