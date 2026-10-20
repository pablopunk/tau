import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serverEnvironment } from "./support";

const CLI = fileURLToPath(new URL("../packages/cli/dist/bin.js", import.meta.url));

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

export interface UpdateServer {
  readonly baseURL: string;
  readonly home: string;
  stop(): Promise<void>;
}

async function waitForServer(baseURL: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`tau serve exited with ${child.exitCode}`);
    const up = await fetch(`${baseURL}/api/update`).then(
      () => true,
      () => false,
    );
    if (up) return;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("tau serve did not become ready");
}

/**
 * The Node build from a dev checkout (`install.mode: none`), a faux server on a scratch home and a random port.
 * It runs as a plain child of the test, never as a service, and `TAU_FAKE_LATEST` makes it "behind".
 */
export async function startDevCheckoutServer(): Promise<UpdateServer> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-e2e-dev-")));
  const home = join(root, "tau-home");
  const port = await freePort();
  const child = spawn("node", [CLI, "serve", "--faux", "--no-open", "--port", String(port), "--home", home], {
    env: { ...process.env, ...serverEnvironment(), HOME: root, TAU_FAKE_LATEST: "9.9.9" },
    stdio: "ignore",
  });
  const baseURL = `http://127.0.0.1:${port}`;
  await waitForServer(baseURL, child);
  return { baseURL, home, stop: async () => void child.kill("SIGTERM") };
}
